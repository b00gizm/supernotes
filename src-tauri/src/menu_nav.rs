//! App menu with accelerators.
//!
//! On macOS WKWebView, Cmd+digit (and some other Cmd chords) never reach JS —
//! the webview eats them for tab selection. Native menu accelerators still fire.

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Runtime,
};

pub fn install_app_menu<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let daily = MenuItemBuilder::with_id("nav-daily", "Daily Note")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let notes = MenuItemBuilder::with_id("nav-notes", "Notes")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let tasks = MenuItemBuilder::with_id("nav-tasks", "Tasks")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let calendar = MenuItemBuilder::with_id("nav-calendar", "Calendar")
        .accelerator("CmdOrCtrl+4")
        .build(app)?;
    let prev = MenuItemBuilder::with_id("daily-prev", "Previous Day")
        .accelerator("CmdOrCtrl+Shift+Left")
        .build(app)?;
    let next = MenuItemBuilder::with_id("daily-next", "Next Day")
        .accelerator("CmdOrCtrl+Shift+Right")
        .build(app)?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let go = SubmenuBuilder::new(app, "Go")
        .item(&daily)
        .item(&notes)
        .item(&tasks)
        .item(&calendar)
        .separator()
        .item(&prev)
        .item(&next)
        .build()?;

    // macOS menu bar requires Submenu roots; first submenu becomes the app menu.
    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(app, "Supernotes")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app)
            .item(&app_menu)
            .item(&edit)
            .item(&go)
            .build()?
    };

    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app).item(&edit).item(&go).build()?;

    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        match id {
            "nav-daily" | "nav-notes" | "nav-tasks" | "nav-calendar" | "daily-prev"
            | "daily-next" => {
                let _ = app.emit("menu-nav", id);
            }
            _ => {}
        }
    });

    Ok(())
}
