<div align="center">

# global-menu@deverdi

**A macOS-style global menu applet for the Cinnamon desktop.**  
Moves the focused application's menu bar into the panel — clean, minimal, always there.

*Cinnamon masaüstü için macOS tarzı global menü applet'i.*  
*Odaktaki uygulamanın menü çubuğunu panele taşır.*

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Cinnamon](https://img.shields.io/badge/Cinnamon-applet-green.svg)](https://cinnamon-spices.linuxmint.com/)

</div>

---

## Screenshot / Ekran Görüntüsü

> **Tip:** Replace the placeholder below with an actual screenshot of your panel.  
> `![Global Menu in action](screenshots/preview.png)`

---

## Features / Özellikler

| | English | Türkçe |
|---|---|---|
| 🖥️ | **System menu** — Customisable logo (distro icon, Mint, Cinnamon, or plain text) with quick access to system actions | **Sistem menüsü** — Özelleştirilebilir logo ile sistem aksiyonlarına hızlı erişim |
| 🏷️ | **App name button** — Shows the focused window's name; click to open window controls | **Uygulama butonu** — Odaktaki pencerenin adını gösterir; tıklanınca pencere kontrolleri |
| 📋 | **Dynamic menu bar** — Streams the app's File, Edit, View… menus live into the panel | **Dinamik menü çubuğu** — Uygulamanın menülerini panelde canlı gösterir |
| 🔌 | **DBusMenu support** — Fetches menu trees via `com.canonical.dbusmenu` | **DBusMenu desteği** — `com.canonical.dbusmenu` protokolüyle menü ağacı alır |
| 🐢 | **GTK Menus support** — `org.gtk.Menus` / `org.gtk.Actions` with full Unity/Win/App action proxy | **GTK Menus desteği** — Üçlü action proxy yapısıyla GTK uygulamalarını destekler |
| ✨ | **Marquee animation** — Long window titles scroll smoothly on hover | **Marquee animasyonu** — Uzun başlıklar fareyle üzerine gelinince kayar |
| 🔁 | **WM class overrides** — Map any WM class to a custom display name | **WM sınıfı eşleme** — Uygulama adları özelleştirilebilir |

---

## Installation / Kurulum

```bash
git clone https://github.com/deverdi/global-menu \
  ~/.local/share/cinnamon/applets/global-menu@deverdi
```

**EN:** Restart Cinnamon (`Alt+F2` → `r`), then add **Global Menu** from the Applet manager.  
**TR:** Cinnamon'u yeniden başlatın (`Alt+F2` → `r`), ardından Applet yöneticisinden **Global Menu**'yü panele ekleyin.

---

## Project Structure / Proje Yapısı

```
global-menu@deverdi/
├── applet.js            # Main applet class (GlobalMenuApplet)
├── dbusMenu.js          # DBusMenu client
├── metadata.json        # UUID & version info
├── stylesheet.css       # Panel theme (global-menu-* classes)
├── settings-schema.json # User-facing settings
└── LICENSE              # GPL-3.0
```

### Panel layout / Panel düzeni

```
[ 🐧 systemButton ] [ Firefox appButton ] [ File  Edit  View  … dynamicBox ]
  global-menu-system   global-menu-app          global-menu-dynamic
```

| Region | CSS class | Content |
|---|---|---|
| `systemButton` | `global-menu-system` | System logo → opens system menu |
| `appButton` | `global-menu-app` | Focused app name → opens window controls |
| `dynamicBox` | `global-menu-dynamic` | Live application menu titles |

### Dropdown menus / Açılır menüler

**System menu** — Actions read from `settings-schema.json`: About, Settings, App Store, Recent Items, Force Quit, Sleep, Restart, Shut Down, Lock, Log Out, and custom script execution.

**Window controls** — Fullscreen, minimise, maximise/restore, close.

**App menus** — The real menus of the focused application, rendered as Cinnamon popup menus.

---

## Settings / Ayarlar

| Key | Type | Description / Açıklama |
|---|---|---|
| `show-system-menu` | checkbox | Show/hide the system logo button |
| `system-menu-logo` | combobox | Logo style: `distributor` · `mint` · `cinnamon` · `text` |
| `system-menu-logo-size` | spinbutton | Logo size — 10–28 px |
| `app-name-overrides` | list | Map WM class → custom display name |
| `system-menu-items` | list | System menu items (label, icon, action/command) |
| `show-window-title` | checkbox | Show/hide window title |
| `show-no-exported-menu` | checkbox | Show warning when app exports no menu |
| `menu-width` | spinbutton | Applet width — 240–1200 px |

---

## Technical Notes / Teknik Detaylar

### Focus tracking / Odak takibi

The applet listens to `notify::focus-window` on `global.display`. When the focused window changes, the menu reloads automatically.

*Applet, `global.display` üzerindeki `notify::focus-window` sinyalini dinler. Pencere değişince menü otomatik yeniden yüklenir.*

### dbusMenu.js internals

| Component | Role |
|---|---|
| `PropertyStore` | Stores menu item properties with type checking and defaults |
| `DbusMenuItem` | Wraps a single DBusMenu item into a Cinnamon `PopupMenuAbstractItem` |
| `DBusClient` | Connects to the service, fetches the full tree via `GetLayout`, listens to `LayoutUpdated` / `ItemsPropertiesUpdated`; handles GC and lazy submenu loading |

---

## License / Lisans

[GPL-3.0](LICENSE) © 2026 deverdi
