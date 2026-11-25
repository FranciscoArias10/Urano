//! Soporte nativo de corrección ortográfica para WebKitGTK y validación ultrarrápida con Hunspell (spellbook).

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

type DictMap = Mutex<HashMap<String, Arc<spellbook::Dictionary>>>;
static DICTIONARIES: OnceLock<DictMap> = OnceLock::new();
/// Idiomas cuyo diccionario no se pudo cargar: evita reintentar acceso a disco en cada tecla.
static FAILED_LOADS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
/// Serializa la carga de diccionarios para no leer/parsear el mismo archivo dos veces en paralelo.
static LOAD_LOCK: Mutex<()> = Mutex::new(());
/// `resource_dir()` de Tauri (registrado en `setup`), donde el bundle instala `resources/dictionaries/*`.
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

const FAILED_RETRY_AFTER: Duration = Duration::from_secs(30);

fn get_dict_cache() -> &'static DictMap {
    DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_failed_loads() -> &'static Mutex<HashMap<String, Instant>> {
    FAILED_LOADS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registra el directorio de recursos de la app (Tauri `app.path().resource_dir()`).
pub fn register_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

fn get_or_load_dictionary(lang: &str) -> Result<Arc<spellbook::Dictionary>, String> {
    let mapped = map_language_to_hunspell(lang);
    let cache = get_dict_cache();

    {
        let guard = cache.lock().map_err(|e| e.to_string())?;
        if let Some(dict) = guard.get(&mapped) {
            return Ok(Arc::clone(dict));
        }
    }

    if let Ok(failed) = get_failed_loads().lock() {
        if let Some(when) = failed.get(&mapped) {
            if when.elapsed() < FAILED_RETRY_AFTER {
                return Err(format!("Diccionario '{}' no disponible (reintento pendiente)", mapped));
            }
        }
    }

    let _load_guard = LOAD_LOCK.lock().map_err(|e| e.to_string())?;

    // Otro hilo pudo haberlo cargado mientras esperábamos el lock
    {
        let guard = cache.lock().map_err(|e| e.to_string())?;
        if let Some(dict) = guard.get(&mapped) {
            return Ok(Arc::clone(dict));
        }
    }

    let loaded = load_hunspell_dictionary(mapped.clone()).and_then(|(aff, dic)| {
        spellbook::Dictionary::new(&aff, &dic)
            .map_err(|e| format!("Error cargando diccionario Hunspell para '{}': {:?}", mapped, e))
    });

    match loaded {
        Ok(dict) => {
            let arc_dict = Arc::new(dict);
            if let Ok(mut failed) = get_failed_loads().lock() {
                failed.remove(&mapped);
            }
            let mut guard = cache.lock().map_err(|e| e.to_string())?;
            guard.insert(mapped, Arc::clone(&arc_dict));
            Ok(arc_dict)
        }
        Err(e) => {
            if let Ok(mut failed) = get_failed_loads().lock() {
                failed.insert(mapped, Instant::now());
            }
            Err(e)
        }
    }
}

/// Convierte el idioma de Settings de Urano al código regional exacto de archivo Hunspell / Enchant.
pub fn map_language_to_hunspell(lang: &str) -> String {
    let clean = lang.trim().to_lowercase();
    match clean.as_str() {
        "en" | "en-us" | "en_us" | "english" | "english (us)" => "en_US",
        "en-gb" | "en_gb" | "english (gb)" | "british english" => "en_GB",
        "es" | "es-es" | "es_es" | "español" | "spanish" => "es_ES",
        "es-ar" | "es_ar" | "español (argentina)" => "es_AR",
        "fr" | "fr-fr" | "fr_fr" | "français" | "french" => "fr_FR",
        "de" | "de-de" | "de_de" | "deutsch" | "german" => "de_DE",
        "it" | "it-it" | "it_it" | "italiano" | "italian" => "it_IT",
        "pt" | "pt-pt" | "pt_pt" | "português" | "portuguese" => "pt_PT",
        "pt-br" | "pt_br" | "português (brasil)" => "pt_BR",
        other => {
            if let Some((lang_part, reg_part)) = other.split_once('-') {
                return format!("{}_{}", lang_part.to_lowercase(), reg_part.to_uppercase());
            }
            if let Some((lang_part, reg_part)) = other.split_once('_') {
                return format!("{}_{}", lang_part.to_lowercase(), reg_part.to_uppercase());
            }
            other
        }
    }
    .to_string()
}

/// Variante regional empaquetada que se usa si la exacta no existe (p. ej. `es_AR` → `es_ES`).
fn fallback_hunspell_code(mapped: &str) -> Option<&'static str> {
    let base = mapped.split('_').next().unwrap_or(mapped).to_lowercase();
    match base.as_str() {
        "en" if mapped != "en_US" => Some("en_US"),
        "es" if mapped != "es_ES" => Some("es_ES"),
        _ => None,
    }
}

/// Directorio personal del usuario multiplataforma: `$HOME` (Unix / Git Bash) o
/// `%USERPROFILE%` / `%HOMEDRIVE%%HOMEPATH%` (Windows, donde `$HOME` no existe).
pub fn user_home_dir() -> Option<PathBuf> {
    for key in ["HOME", "USERPROFILE"] {
        if let Some(value) = std::env::var_os(key) {
            if !value.is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }
    match (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
        (Some(drive), Some(path)) if !drive.is_empty() && !path.is_empty() => {
            let mut full = drive;
            full.push(path);
            Some(PathBuf::from(full))
        }
        _ => None,
    }
}

/// Construye la lista ordenada de directorios candidatos a contener `<código>.aff/.dic`.
/// Función pura para poder probarla sin depender del entorno real.
pub fn dictionary_search_dirs_from(
    resource_dir: Option<&Path>,
    exe_dir: Option<&Path>,
    cwd: Option<&Path>,
    home: Option<&Path>,
    dicpath: Option<OsString>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // 1. Recursos empaquetados por Tauri (`bundle.resources: ["resources/dictionaries/*"]`)
    if let Some(res) = resource_dir {
        dirs.push(res.join("resources").join("dictionaries"));
        dirs.push(res.join("dictionaries"));
        dirs.push(res.join("_up_").join("public").join("dictionaries"));
        dirs.push(res.to_path_buf());
    }

    // 2. Junto al ejecutable (Windows: recursos al lado del .exe; macOS/Linux: rutas del bundle)
    if let Some(exe) = exe_dir {
        dirs.push(exe.join("resources").join("dictionaries"));
        dirs.push(exe.join("dictionaries"));
        dirs.push(exe.join("..").join("resources").join("dictionaries"));
        dirs.push(exe.join("..").join("Resources").join("resources").join("dictionaries"));
        dirs.push(exe.join("..").join("Resources").join("dictionaries"));
        dirs.push(exe.join("..").join("lib").join("urano").join("resources").join("dictionaries"));
    }

    // 3. Desarrollo (`tauri dev` / `cargo test` ejecutan desde la raíz o desde `src-tauri`)
    if let Some(cwd) = cwd {
        dirs.push(cwd.join("src-tauri").join("resources").join("dictionaries"));
        dirs.push(cwd.join("resources").join("dictionaries"));
        dirs.push(cwd.join("..").join("src-tauri").join("resources").join("dictionaries"));
        dirs.push(cwd.join("public").join("dictionaries"));
        dirs.push(cwd.join("..").join("public").join("dictionaries"));
    }

    // 4. DICPATH explícito del usuario / sistema
    if let Some(raw) = dicpath {
        dirs.extend(std::env::split_paths(&raw));
    }

    // 5. Diccionarios sincronizados para enchant en el home del usuario
    if let Some(home) = home {
        dirs.push(home.join(".config").join("enchant").join("hunspell"));
        dirs.push(home.join(".local").join("share").join("enchant").join("hunspell"));
    }

    // 6. Rutas estándar de Linux
    if cfg!(unix) {
        dirs.push(PathBuf::from("/usr/share/hunspell"));
        dirs.push(PathBuf::from("/usr/share/myspell/dicts"));
        dirs.push(PathBuf::from("/usr/share/myspell"));
    }

    let mut seen = HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

fn dictionary_search_dirs() -> Vec<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let cwd = std::env::current_dir().ok();
    let home = user_home_dir();
    dictionary_search_dirs_from(
        RESOURCE_DIR.get().map(PathBuf::as_path),
        exe_dir.as_deref(),
        cwd.as_deref(),
        home.as_deref(),
        std::env::var_os("DICPATH"),
    )
}

/// Busca el par `<código>.aff` + `<código>.dic` en los directorios dados (en orden),
/// o como respaldo `<idioma_base>/index.aff` + `<idioma_base>/index.dic` (`public/dictionaries`).
pub fn find_dictionary_in_dirs(code: &str, dirs: &[PathBuf]) -> Option<(PathBuf, PathBuf)> {
    if let Some(pair) = dirs.iter().find_map(|dir| {
        let aff = dir.join(format!("{}.aff", code));
        let dic = dir.join(format!("{}.dic", code));
        (aff.is_file() && dic.is_file()).then_some((aff, dic))
    }) {
        return Some(pair);
    }

    let base = code.split(['_', '-']).next().unwrap_or(code).to_lowercase();
    dirs.iter().find_map(|dir| {
        let aff = dir.join(&base).join("index.aff");
        let dic = dir.join(&base).join("index.dic");
        (aff.is_file() && dic.is_file()).then_some((aff, dic))
    })
}

fn read_dictionary_text(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

/// Localiza los diccionarios Hunspell empaquetados en Urano. En Linux además configura `DICPATH`
/// y los copia a `~/.config/enchant/hunspell/` y `~/.local/share/enchant/hunspell/` para WebKitGTK.
pub fn setup_hunspell_dictionaries() {
    let dirs = dictionary_search_dirs();
    let Some((aff_path, _)) = find_dictionary_in_dirs("en_US", &dirs) else {
        eprintln!("[Spellcheck] No se encontró el directorio de diccionarios Hunspell en las rutas candidatas.");
        return;
    };
    let Some(dict_dir_path) = aff_path.parent().map(Path::to_path_buf) else {
        return;
    };
    println!("[Spellcheck] Diccionarios Hunspell encontrados en: {}", dict_dir_path.display());

    #[cfg(target_os = "linux")]
    {
        // Configurar DICPATH para que libenchant y hunspell resuelvan los diccionarios
        if let Ok(canonical) = dict_dir_path.canonicalize() {
            std::env::set_var("DICPATH", &canonical);
        }

        if let Some(home_path) = user_home_dir() {
            let target_dirs = [
                home_path.join(".config/enchant/hunspell"),
                home_path.join(".local/share/enchant/hunspell"),
            ];
            let files = ["en_US.aff", "en_US.dic", "es_ES.aff", "es_ES.dic", "en_GB.aff", "en_GB.dic"];

            for target_dir in &target_dirs {
                if let Err(e) = std::fs::create_dir_all(target_dir) {
                    eprintln!("[Spellcheck] Error creando directorio {:?}: {}", target_dir, e);
                    continue;
                }
                for file in &files {
                    let src_file = dict_dir_path.join(file);
                    let dest_file = target_dir.join(file);
                    if !src_file.exists() {
                        continue;
                    }
                    let should_copy = match (src_file.metadata(), dest_file.metadata()) {
                        (Ok(sm), Ok(dm)) => sm.len() != dm.len(),
                        _ => true,
                    };
                    if should_copy {
                        if let Err(e) = std::fs::copy(&src_file, &dest_file) {
                            eprintln!("[Spellcheck] Error copiando {:?} a {:?}: {}", src_file, dest_file, e);
                        }
                    }
                }
            }
        }
    }
}

/// Aplica el idioma y el estado activo del corrector ortográfico directamente en WebKitGTK.
#[tauri::command]
pub fn set_spellcheck_language(window: tauri::WebviewWindow, lang: String, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{WebContextExt, WebViewExt};

        let mapped_lang = map_language_to_hunspell(&lang);

        window.with_webview(move |webview| {
            let view = webview.inner();

            if let Some(context) = view.context() {
                context.set_spell_checking_enabled(enabled);
                if enabled && !mapped_lang.is_empty() {
                    context.set_spell_checking_languages(&[mapped_lang.as_str()]);
                }
            }
        }).map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, lang, enabled);
        Ok(())
    }
}

/// Normaliza apóstrofes tipográficos (`’`, `ʼ`) al ASCII `'` que usan los `.dic`.
fn normalize_apostrophes(word: &str) -> String {
    word.replace(['\u{2019}', '\u{02BC}', '\u{2018}'], "'")
}

fn is_word_correct(dict: &spellbook::Dictionary, word: &str) -> bool {
    if dict.check(word) {
        return true;
    }
    let lower = word.to_lowercase();
    if lower != word && dict.check(&lower) {
        return true;
    }
    if word.contains(['\u{2019}', '\u{02BC}', '\u{2018}']) {
        let normalized = normalize_apostrophes(word);
        if dict.check(&normalized) || dict.check(&normalized.to_lowercase()) {
            return true;
        }
    }
    false
}

/// Versión síncrona de `check_words_batch` (usada por el comando asíncrono y por los tests).
pub fn check_words_batch_sync(words: Vec<String>, lang: &str, custom_words: Vec<String>) -> Vec<String> {
    if words.is_empty() {
        return Vec::new();
    }

    let dict = match get_or_load_dictionary(lang) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[Spellcheck] Error al obtener diccionario para '{}': {}", lang, e);
            return Vec::new();
        }
    };

    let custom_set: HashSet<String> = custom_words
        .into_iter()
        .map(|w| normalize_apostrophes(w.trim()).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect();

    let mut misspelled = Vec::new();

    for word in words {
        let clean = word.trim();
        if clean.is_empty() {
            continue;
        }

        // 1. Diccionario personalizado de usuario
        if custom_set.contains(&normalize_apostrophes(clean).to_lowercase()) {
            continue;
        }

        // 2. Diccionario nativo Hunspell (incluye contracciones como doesn't / doesn’t)
        if is_word_correct(&dict, clean) {
            continue;
        }

        misspelled.push(word);
    }

    misspelled
}

/// Valida un lote de palabras en memoria con spellbook y devuelve solo las mal escritas.
/// Se ejecuta fuera del hilo principal para no bloquear la UI durante la primera carga del diccionario.
#[tauri::command]
pub async fn check_words_batch(words: Vec<String>, lang: String, custom_words: Vec<String>) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || check_words_batch_sync(words, &lang, custom_words))
        .await
        .unwrap_or_default()
}

/// Versión síncrona de `suggest_word`.
pub fn suggest_word_sync(word: &str, lang: &str) -> Vec<String> {
    let clean = word.trim();
    if clean.is_empty() {
        return Vec::new();
    }

    let mut suggestions = Vec::new();

    if let Ok(dict) = get_or_load_dictionary(lang) {
        let normalized = normalize_apostrophes(clean);
        dict.suggest(&normalized, &mut suggestions);
        if suggestions.is_empty() {
            dict.suggest(&normalized.to_lowercase(), &mut suggestions);
        }
    }

    // Respaldo adicional con enchant-2 (solo existe en Linux)
    #[cfg(target_os = "linux")]
    if suggestions.len() < 3 {
        let mapped = map_language_to_hunspell(lang);
        if let Ok(output) = std::process::Command::new("enchant-2")
            .arg("-d")
            .arg(&mapped)
            .arg("-a")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(clean.as_bytes());
                    let _ = stdin.write_all(b"\n");
                }
                child.wait_with_output()
            })
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.starts_with('&') {
                        if let Some((_, list)) = line.split_once(": ") {
                            for sug in list.split(',') {
                                let s = sug.trim().to_string();
                                if !s.is_empty() && !suggestions.contains(&s) {
                                    suggestions.push(s);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    suggestions.truncate(6);
    suggestions
}

/// Genera sugerencias de corrección ortográfica para una palabra dada.
#[tauri::command]
pub async fn suggest_word(word: String, lang: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || suggest_word_sync(&word, &lang))
        .await
        .unwrap_or_default()
}

/// Carga desde disco los archivos .aff y .dic para el idioma solicitado.
#[tauri::command]
pub fn load_hunspell_dictionary(lang: String) -> Result<(String, String), String> {
    let mapped_code = map_language_to_hunspell(&lang);
    let dirs = dictionary_search_dirs();

    let found = find_dictionary_in_dirs(&mapped_code, &dirs).or_else(|| {
        fallback_hunspell_code(&mapped_code).and_then(|code| find_dictionary_in_dirs(code, &dirs))
    });

    if let Some((aff_path, dic_path)) = found {
        let aff = read_dictionary_text(&aff_path)?;
        let dic = read_dictionary_text(&dic_path)?;
        return Ok((aff, dic));
    }

    Err(format!(
        "Hunspell dictionary files not found on disk for language '{}' (mapped: '{}'). Searched: {:?}",
        lang, mapped_code, dirs
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("urano_spell_{}_{}_{}", tag, std::process::id(), nanos));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_spellbook_en_and_es() {
        let (aff_en, dic_en) = load_hunspell_dictionary("en_US".to_string()).unwrap();
        let dict_en = spellbook::Dictionary::new(&aff_en, &dic_en).expect("en_US load failed");
        assert!(dict_en.check("hello"));
        assert!(dict_en.check("world"));
        assert!(!dict_en.check("holaaa"));
        assert!(!dict_en.check("hhhh"));

        let (aff_es, dic_es) = load_hunspell_dictionary("es_ES".to_string()).unwrap();
        let dict_es = spellbook::Dictionary::new(&aff_es, &dic_es).expect("es_ES load failed");
        assert!(dict_es.check("hola"));
        assert!(!dict_es.check("holaaa"));
        assert!(!dict_es.check("hhhh"));
    }

    #[test]
    fn test_check_words_batch() {
        let words = vec!["hello".to_string(), "world".to_string(), "holaaa".to_string(), "hhhh".to_string()];
        let bad = check_words_batch_sync(words, "en", vec![]);
        assert_eq!(bad, vec!["holaaa".to_string(), "hhhh".to_string()]);
    }

    #[test]
    fn test_contractions_with_ascii_and_typographic_apostrophes() {
        let words = vec![
            "doesn't".to_string(),
            "doesn\u{2019}t".to_string(),
            "don't".to_string(),
            "isn\u{2019}t".to_string(),
            "Doesn't".to_string(),
            "holaaa".to_string(),
        ];
        let bad = check_words_batch_sync(words, "en", vec![]);
        assert_eq!(bad, vec!["holaaa".to_string()]);
    }

    #[test]
    fn test_custom_dictionary_normalizes_apostrophes_and_case() {
        let words = vec!["Urano\u{2019}s".to_string(), "zzqx".to_string()];
        let bad = check_words_batch_sync(words, "en", vec!["urano's".to_string()]);
        assert_eq!(bad, vec!["zzqx".to_string()]);
    }

    #[test]
    fn test_search_dirs_prioritize_resource_dir_and_exe_dir_without_home() {
        let res = PathBuf::from(r"C:\Program Files\Urano");
        let exe = PathBuf::from(r"C:\Program Files\Urano");
        let dirs = dictionary_search_dirs_from(Some(&res), Some(&exe), None, None, None);
        assert_eq!(dirs[0], res.join("resources").join("dictionaries"));
        assert!(dirs.contains(&exe.join("resources").join("dictionaries")));
        // Sin HOME no se generan rutas basadas en el home
        assert!(!dirs.iter().any(|d| d.to_string_lossy().contains("enchant")));
        // Sin duplicados aunque resource_dir == exe_dir
        let unique: HashSet<_> = dirs.iter().collect();
        assert_eq!(unique.len(), dirs.len());
    }

    #[test]
    fn test_search_dirs_include_userprofile_home_and_dicpath() {
        let home = PathBuf::from(r"C:\Users\admin");
        let extra = unique_temp_dir("dicpath");
        let dirs = dictionary_search_dirs_from(
            None,
            None,
            None,
            Some(&home),
            Some(std::env::join_paths([extra.clone()]).unwrap()),
        );
        assert!(dirs.contains(&extra));
        assert!(dirs.contains(&home.join(".config").join("enchant").join("hunspell")));
        let _ = std::fs::remove_dir_all(extra);
    }

    #[test]
    fn test_find_dictionary_in_bundled_resource_layout() {
        let root = unique_temp_dir("bundle");
        let dict_dir = root.join("resources").join("dictionaries");
        std::fs::create_dir_all(&dict_dir).unwrap();
        std::fs::write(dict_dir.join("es_ES.aff"), "SET UTF-8\n").unwrap();
        std::fs::write(dict_dir.join("es_ES.dic"), "1\nhola\n").unwrap();

        let dirs = dictionary_search_dirs_from(Some(&root), None, None, None, None);
        let (aff, dic) = find_dictionary_in_dirs("es_ES", &dirs).expect("must find bundled dictionary");
        assert_eq!(aff, dict_dir.join("es_ES.aff"));
        assert_eq!(dic, dict_dir.join("es_ES.dic"));
        assert!(find_dictionary_in_dirs("fr_FR", &dirs).is_none());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_fallback_code_and_language_mapping() {
        assert_eq!(map_language_to_hunspell("es-AR"), "es_AR");
        assert_eq!(fallback_hunspell_code("es_AR"), Some("es_ES"));
        assert_eq!(fallback_hunspell_code("en_AU"), Some("en_US"));
        assert_eq!(fallback_hunspell_code("en_US"), None);
        assert_eq!(map_language_to_hunspell("en_us"), "en_US");
    }

    #[test]
    fn test_public_dictionaries_subdir_fallback() {
        let (aff_fr, dic_fr) = load_hunspell_dictionary("fr".to_string()).unwrap();
        let dict_fr = spellbook::Dictionary::new(&aff_fr, &dic_fr).expect("fr load failed");
        assert!(dict_fr.check("bonjour"));
        assert!(!dict_fr.check("zzqxxw"));
    }
}
