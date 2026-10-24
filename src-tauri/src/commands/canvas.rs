//! Pellizco de touchpad confinado al Canvas (Linux / WebKitGTK).
//!
//! WebKitGTK instala un `GtkGestureZoom` sobre el propio widget del webview y,
//! en `scale-changed`, llama a `ViewGestureController::setMagnification`, que
//! escala la página entera (page zoom). Ese gesto NO genera ningún evento DOM
//! (ni `wheel` con ctrlKey ni `gesturechange`), por lo que `preventDefault()`
//! desde JavaScript no puede evitarlo: de ahí que el pellizco agrandase toda
//! la interfaz de Urano en lugar de solo el lienzo.
//!
//! En GTK3 la señal `event` del widget se emite ANTES de ejecutar los
//! controladores de fase bubble (donde vive ese `GtkGestureZoom`). Si nuestro
//! handler devuelve `Propagation::Stop` para `GDK_TOUCHPAD_PINCH`, WebKit nunca
//! ve el gesto. Lo hacemos únicamente mientras el frontend indica que el
//! puntero está sobre un Canvas (`set_canvas_pinch_capture`), y reenviamos el
//! gesto como evento Tauri para que el lienzo aplique su propio zoom anclado
//! sobre la cámara (panX / panY / zoom). En el resto de vistas (.md, imágenes…)
//! el gesto sigue su curso nativo, sin cambios.

use std::sync::atomic::{AtomicBool, Ordering};

/// `true` mientras el puntero está sobre un lienzo Canvas en el frontend.
static CANVAS_PINCH_CAPTURE: AtomicBool = AtomicBool::new(false);

/// Nombre del evento Tauri con el que se reenvía el pellizco al frontend.
pub const CANVAS_PINCH_EVENT: &str = "canvas:touchpad-pinch";

/// El frontend lo invoca al entrar / salir del contenedor del Canvas.
#[tauri::command]
pub fn set_canvas_pinch_capture(enabled: bool) {
    CANVAS_PINCH_CAPTURE.store(enabled, Ordering::Relaxed);
}

#[derive(Clone, serde::Serialize)]
pub struct TouchpadPinchPayload {
    /// `begin` | `update` | `end` | `cancel`
    pub phase: &'static str,
    /// Escala acumulada respecto al inicio del gesto (1.0 en `begin`).
    pub scale: f64,
    /// Foco del gesto en píxeles lógicos relativos al webview
    /// (coinciden con `clientX` / `clientY` del DOM).
    pub x: f64,
    pub y: f64,
    /// Desplazamiento del foco desde el evento anterior (pan de dos dedos).
    pub dx: f64,
    pub dy: f64,
    pub fingers: i8,
}

/// Intercepta `GDK_TOUCHPAD_PINCH` en el widget WebKitGTK de la ventana.
#[cfg(target_os = "linux")]
pub fn install_touchpad_pinch_interceptor(window: &tauri::WebviewWindow) {
    use gtk::gdk;
    use gtk::glib;
    use gtk::prelude::*;
    use tauri::Emitter;

    let emitter = window.clone();
    let result = window.with_webview(move |webview| {
        let view = webview.inner();
        view.connect_event(move |_, event| {
            if event.event_type() != gdk::EventType::TouchpadPinch
                || !CANVAS_PINCH_CAPTURE.load(Ordering::Relaxed)
            {
                return glib::Propagation::Proceed;
            }
            let Some(pinch) = event.downcast_ref::<gdk::EventTouchpadPinch>() else {
                return glib::Propagation::Proceed;
            };

            // `EventTouchpadPinch::is_phase()` de gdk-rs 0.18 devuelve un bool
            // inútil; la fase real está en el struct C.
            let raw: &gdk::ffi::GdkEventTouchpadPinch = pinch.as_ref();
            let phase = match raw.phase as i32 {
                gdk::ffi::GDK_TOUCHPAD_GESTURE_PHASE_BEGIN => "begin",
                gdk::ffi::GDK_TOUCHPAD_GESTURE_PHASE_UPDATE => "update",
                gdk::ffi::GDK_TOUCHPAD_GESTURE_PHASE_END => "end",
                _ => "cancel",
            };
            let (x, y) = pinch.position();
            let (dx, dy) = pinch.delta();
            let payload = TouchpadPinchPayload {
                phase,
                scale: pinch.scale(),
                x,
                y,
                dx,
                dy,
                fingers: pinch.n_fingers(),
            };
            if let Err(err) = emitter.emit(CANVAS_PINCH_EVENT, payload) {
                log::warn!("No se pudo reenviar el pellizco al Canvas: {err}");
            }
            // Consumido: el GtkGestureZoom de WebKit (fase bubble) no lo verá.
            glib::Propagation::Stop
        });
    });

    if let Err(err) = result {
        log::warn!("No se pudo instalar el interceptor de pellizco del Canvas: {err}");
    }
}
