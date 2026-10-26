//! Soporte nativo de corrección ortográfica para WebKitGTK y validación ultrarrápida con Hunspell (spellbook).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

type DictMap = Mutex<HashMap<String, Arc<spellbook::Dictionary>>>;
static DICTIONARIES: OnceLock<DictMap> = OnceLock::new();

fn get_dict_cache() -> &'static DictMap {
    DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()))
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

    // Cargar archivos de diccionario desde disco
    let (aff, dic) = load_hunspell_dictionary(mapped.clone())?;
    let dict = spellbook::Dictionary::new(&aff, &dic)
        .map_err(|e| format!("Error cargando diccionario Hunspell para '{}': {:?}", mapped, e))?;
    let arc_dict = Arc::new(dict);

    let mut guard = cache.lock().map_err(|e| e.to_string())?;
    guard.insert(mapped, Arc::clone(&arc_dict));
    Ok(arc_dict)
}

/// Convierte el idioma de Settings de Urano al código regional exacto de archivo Hunspell / Enchant.
pub fn map_language_to_hunspell(lang: &str) -> String {
    let clean = lang.trim().to_lowercase();
    match clean.as_str() {
        "en" | "en-us" | "english" | "english (us)" => "en_US",
        "en-gb" | "english (gb)" | "british english" => "en_GB",
        "es" | "es-es" | "español" | "spanish" => "es_ES",
        "es-ar" | "español (argentina)" => "es_AR",
        "fr" | "fr-fr" | "français" | "french" => "fr_FR",
        "de" | "de-de" | "deutsch" | "german" => "de_DE",
        "it" | "it-it" | "italiano" | "italian" => "it_IT",
        "pt" | "pt-pt" | "português" | "portuguese" => "pt_PT",
        "pt-br" | "português (brasil)" => "pt_BR",
        other => {
            if let Some((lang_part, reg_part)) = other.split_once('-') {
                return format!("{}_{}", lang_part.to_lowercase(), reg_part.to_uppercase());
            }
            if let Some((lang_part, reg_part)) = other.split_once('_') {
                return format!("{}_{}", lang_part.to_lowercase(), reg_part.to_uppercase());
            }
            other
        }
    }.to_string()
}

/// Localiza los diccionarios Hunspell empaquetados en Urano, los copia a los directorios estándar de usuario
/// (`~/.config/enchant/hunspell/` y `~/.local/share/enchant/hunspell/`) y configura la variable de entorno `DICPATH`.
pub fn setup_hunspell_dictionaries() {
    let mut candidate_dirs = Vec::new();

    // 1. Relativo a current_dir
    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.join("src-tauri/resources/dictionaries"));
        candidate_dirs.push(cwd.join("resources/dictionaries"));
        candidate_dirs.push(cwd.join("../src-tauri/resources/dictionaries"));
    }

    // 2. Relativo al binario ejecutable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidate_dirs.push(parent.join("resources/dictionaries"));
            candidate_dirs.push(parent.join("../resources/dictionaries"));
            candidate_dirs.push(parent.join("../Resources/dictionaries"));
        }
    }

    let found_dict_dir = candidate_dirs
        .into_iter()
        .find(|d| d.exists() && d.join("en_US.dic").exists());

    let dict_dir_path = match found_dict_dir {
        Some(dir) => dir,
        None => {
            eprintln!("[Spellcheck] No se encontró el directorio de diccionarios Hunspell en las rutas candidatas.");
            return;
        }
    };

    // Configurar DICPATH para que libenchant y hunspell resuelvan los diccionarios
    if let Ok(canonical) = dict_dir_path.canonicalize() {
        if let Some(path_str) = canonical.to_str() {
            std::env::set_var("DICPATH", path_str);
            println!("[Spellcheck] DICPATH configurado en: {}", path_str);
        }
    }

    // Copiar diccionarios a ~/.config/enchant/hunspell/ y ~/.local/share/enchant/hunspell/
    if let Some(home) = std::env::var_os("HOME") {
        let home_path = std::path::PathBuf::from(home);
        let target_dirs = [
            home_path.join(".config/enchant/hunspell"),
            home_path.join(".local/share/enchant/hunspell"),
        ];

        let files = [
            "en_US.aff",
            "en_US.dic",
            "es_ES.aff",
            "es_ES.dic",
            "en_GB.aff",
            "en_GB.dic",
        ];

        for target_dir in &target_dirs {
            if let Err(e) = std::fs::create_dir_all(target_dir) {
                eprintln!("[Spellcheck] Error creando directorio {:?}: {}", target_dir, e);
                continue;
            }

            for file in &files {
                let src_file = dict_dir_path.join(file);
                let dest_file = target_dir.join(file);
                if src_file.exists() {
                    let should_copy = match (src_file.metadata(), dest_file.metadata()) {
                        (Ok(sm), Ok(dm)) => sm.len() != dm.len(),
                        _ => true,
                    };

                    if should_copy {
                        if let Err(e) = std::fs::copy(&src_file, &dest_file) {
                            eprintln!("[Spellcheck] Error copiando {:?} a {:?}: {}", src_file, dest_file, e);
                        } else {
                            println!("[Spellcheck] Diccionario sincronizado: {:?}", dest_file);
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

/// Valida un lote de palabras de manera síncrona en memoria con spellbook (< 1 ms para 200 palabras)
/// y devuelve exclusivamente la lista de palabras que contienen error ortográfico.
#[tauri::command]
pub fn check_words_batch(
    words: Vec<String>,
    lang: String,
    custom_words: Vec<String>,
) -> Vec<String> {
    if words.is_empty() {
        return Vec::new();
    }

    let dict = match get_or_load_dictionary(&lang) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[Spellcheck] Error al obtener diccionario para '{}': {}", lang, e);
            return Vec::new();
        }
    };

    let custom_set: HashSet<String> = custom_words
        .into_iter()
        .map(|w| w.trim().to_lowercase())
        .filter(|w| !w.is_empty())
        .collect();

    let mut misspelled = Vec::new();

    for word in words {
        let clean = word.trim();
        if clean.is_empty() {
            continue;
        }

        let lower = clean.to_lowercase();
        // 1. Diccionario personalizado de usuario
        if custom_set.contains(&lower) {
            continue;
        }

        // 2. Diccionario nativo Hunspell
        if dict.check(clean) || dict.check(&lower) {
            continue;
        }

        misspelled.push(word);
    }

    misspelled
}

/// Genera sugerencias de corrección ortográfica para una palabra dada usando spellbook y enchant-2.
#[tauri::command]
pub fn suggest_word(word: String, lang: String) -> Vec<String> {
    let clean = word.trim();
    if clean.is_empty() {
        return Vec::new();
    }

    let mut suggestions = Vec::new();

    if let Ok(dict) = get_or_load_dictionary(&lang) {
        dict.suggest(clean, &mut suggestions);
        if suggestions.is_empty() {
            let lower = clean.to_lowercase();
            dict.suggest(&lower, &mut suggestions);
        }
    }

    // Respaldo adicional con enchant-2 si hay pocas sugerencias
    if suggestions.len() < 3 {
        let mapped = map_language_to_hunspell(&lang);
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

/// Carga directamente desde disco los archivos .aff y .dic para el idioma solicitado.
#[tauri::command]
pub fn load_hunspell_dictionary(lang: String) -> Result<(String, String), String> {
    let mapped_code = map_language_to_hunspell(&lang);

    let mut candidate_pairs: Vec<(std::path::PathBuf, std::path::PathBuf)> = Vec::new();

    // 1. Resources de Urano
    if let Ok(cwd) = std::env::current_dir() {
        candidate_pairs.push((
            cwd.join(format!("src-tauri/resources/dictionaries/{}.aff", mapped_code)),
            cwd.join(format!("src-tauri/resources/dictionaries/{}.dic", mapped_code)),
        ));
        candidate_pairs.push((
            cwd.join(format!("resources/dictionaries/{}.aff", mapped_code)),
            cwd.join(format!("resources/dictionaries/{}.dic", mapped_code)),
        ));
    }

    // 2. enchant config dir
    if let Some(home) = std::env::var_os("HOME") {
        let home_path = std::path::PathBuf::from(home);
        candidate_pairs.push((
            home_path.join(format!(".config/enchant/hunspell/{}.aff", mapped_code)),
            home_path.join(format!(".config/enchant/hunspell/{}.dic", mapped_code)),
        ));
    }

    // 3. Rutas estándar del sistema en Arch Linux / Linux
    candidate_pairs.push((
        std::path::PathBuf::from(format!("/usr/share/hunspell/{}.aff", mapped_code)),
        std::path::PathBuf::from(format!("/usr/share/hunspell/{}.dic", mapped_code)),
    ));
    candidate_pairs.push((
        std::path::PathBuf::from(format!("/usr/share/myspell/dicts/{}.aff", mapped_code)),
        std::path::PathBuf::from(format!("/usr/share/myspell/dicts/{}.dic", mapped_code)),
    ));

    for (aff_path, dic_path) in candidate_pairs {
        if aff_path.exists() && dic_path.exists() {
            let aff = std::fs::read_to_string(&aff_path)
                .map_err(|e| format!("Failed to read {}: {}", aff_path.display(), e))?;
            let dic = std::fs::read_to_string(&dic_path)
                .map_err(|e| format!("Failed to read {}: {}", dic_path.display(), e))?;
            return Ok((aff, dic));
        }
    }

    Err(format!(
        "Hunspell dictionary files not found on disk for language '{}' (mapped: '{}')",
        lang, mapped_code
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spellbook_en_and_es() {
        let (aff_en, dic_en) = load_hunspell_dictionary("en_US".to_string()).unwrap();
        let dict_en = spellbook::Dictionary::new(&aff_en, &dic_en).expect("en_US load failed");
        assert!(dict_en.check("hello"));
        assert!(dict_en.check("world"));
        assert!(!dict_en.check("holaaa"));
        assert!(!dict_en.check("hhhh"));

        let mut sugs = Vec::new();
        dict_en.suggest("helo", &mut sugs);
        println!("sugs for helo: {:?}", sugs);

        let (aff_es, dic_es) = load_hunspell_dictionary("es_ES".to_string()).unwrap();
        let dict_es = spellbook::Dictionary::new(&aff_es, &dic_es).expect("es_ES load failed");
        assert!(dict_es.check("hola"));
        assert!(!dict_es.check("holaaa"));
        assert!(!dict_es.check("hhhh"));
    }

    #[test]
    fn test_check_words_batch() {
        let words = vec!["hello".to_string(), "world".to_string(), "holaaa".to_string(), "hhhh".to_string()];
        let bad = check_words_batch(words, "en".to_string(), vec![]);
        assert_eq!(bad, vec!["holaaa".to_string(), "hhhh".to_string()]);
    }
}
