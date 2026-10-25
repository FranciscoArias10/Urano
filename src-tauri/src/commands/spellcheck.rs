//! Soporte nativo de corrección ortográfica para WebKitGTK en Linux.

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
