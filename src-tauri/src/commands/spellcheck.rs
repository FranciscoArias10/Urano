//! Soporte nativo de corrección ortográfica para WebKitGTK y carga de diccionarios Hunspell en disco.

#[tauri::command]
pub fn set_spellcheck_language(window: tauri::WebviewWindow, lang: String, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{WebContextExt, WebViewExt};

        let lang_code = lang.trim().to_lowercase();
        let normalized = match lang_code.as_str() {
            "en" | "en-us" => "en_US",
            "en-gb" => "en_GB",
            "es" | "es-es" => "es_ES",
            "fr" | "fr-fr" => "fr_FR",
            "de" | "de-de" => "de_DE",
            "it" | "it-it" => "it_IT",
            "pt" | "pt-pt" => "pt_PT",
            "pt-br" => "pt_BR",
            other => other,
        };

        let lang_string = normalized.to_string();

        window.with_webview(move |webview| {
            let view = webview.inner();

            if let Some(context) = view.context() {
                context.set_spell_checking_enabled(enabled);
                if enabled && !lang_string.is_empty() {
                    let langs = [&lang_string[..]];
                    context.set_spell_checking_languages(&langs);
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

/// Carga directamente desde disco los archivos .aff y .dic para el idioma solicitado.
/// Busca primero en la carpeta `public/dictionaries/{lang}/` del proyecto y luego en `/usr/share/hunspell/`.
#[tauri::command]
pub fn load_hunspell_dictionary(lang: String) -> Result<(String, String), String> {
    let clean_lang = lang.trim().to_lowercase();
    let base_lang = match clean_lang.as_str() {
        "en" | "en-us" | "en-gb" | "english" => "en",
        "es" | "es-es" | "es-ar" | "español" | "spanish" => "es",
        "fr" | "fr-fr" | "français" | "french" => "fr",
        "de" | "de-de" | "deutsch" | "german" => "de",
        "it" | "it-it" | "italiano" | "italian" => "it",
        "pt" | "pt-pt" | "pt-br" | "português" | "portuguese" => "pt",
        other => {
            if let Some((first, _)) = other.split_once(&['-', '_'][..]) {
                first
            } else {
                other
            }
        }
    };

    let mut candidate_pairs: Vec<(std::path::PathBuf, std::path::PathBuf)> = Vec::new();

    // 1. Cwd relativo (directorio raíz del proyecto Urano)
    candidate_pairs.push((
        std::path::PathBuf::from(format!("public/dictionaries/{}/index.aff", base_lang)),
        std::path::PathBuf::from(format!("public/dictionaries/{}/index.dic", base_lang)),
    ));

    // 2. Parent relativo (cuando cwd es `src-tauri`)
    candidate_pairs.push((
        std::path::PathBuf::from(format!("../public/dictionaries/{}/index.aff", base_lang)),
        std::path::PathBuf::from(format!("../public/dictionaries/{}/index.dic", base_lang)),
    ));

    // 3. src/assets/dictionaries/ como alternativa
    candidate_pairs.push((
        std::path::PathBuf::from(format!("src/assets/dictionaries/{}/index.aff", base_lang)),
        std::path::PathBuf::from(format!("src/assets/dictionaries/{}/index.dic", base_lang)),
    ));
    candidate_pairs.push((
        std::path::PathBuf::from(format!("../src/assets/dictionaries/{}/index.aff", base_lang)),
        std::path::PathBuf::from(format!("../src/assets/dictionaries/{}/index.dic", base_lang)),
    ));

    // 4. Ubicación respecto al ejecutable actual
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidate_pairs.push((
                exe_dir.join(format!("public/dictionaries/{}/index.aff", base_lang)),
                exe_dir.join(format!("public/dictionaries/{}/index.dic", base_lang)),
            ));
            if let Some(parent) = exe_dir.parent() {
                candidate_pairs.push((
                    parent.join(format!("public/dictionaries/{}/index.aff", base_lang)),
                    parent.join(format!("public/dictionaries/{}/index.dic", base_lang)),
                ));
            }
        }
    }

    // 5. Rutas estándar del sistema en Arch Linux / Linux
    let sys_names = match base_lang {
        "en" => vec!["en_US", "en_GB", "en"],
        "es" => vec!["es_ES", "es_AR", "es"],
        "fr" => vec!["fr_FR", "fr"],
        "de" => vec!["de_DE", "de"],
        "it" => vec!["it_IT", "it"],
        "pt" => vec!["pt_PT", "pt_BR", "pt"],
        _ => vec![base_lang],
    };

    for name in sys_names {
        candidate_pairs.push((
            std::path::PathBuf::from(format!("/usr/share/hunspell/{}.aff", name)),
            std::path::PathBuf::from(format!("/usr/share/hunspell/{}.dic", name)),
        ));
        candidate_pairs.push((
            std::path::PathBuf::from(format!("/usr/share/myspell/dicts/{}.aff", name)),
            std::path::PathBuf::from(format!("/usr/share/myspell/dicts/{}.dic", name)),
        ));
    }

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
        "Hunspell dictionary files not found on disk for language '{}'",
        base_lang
    ))
}
