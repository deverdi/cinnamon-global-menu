const Applet = imports.ui.applet;
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const GnomeSession = imports.misc.gnomeSession;
const ScreenSaver = imports.misc.screenSaver;
const DBusMenu = require('./dbusMenu');

const UUID = "global-menu@deverdi";
const REGISTRAR_BUS = "com.canonical.AppMenu.Registrar";
const REGISTRAR_PATH = "/com/canonical/AppMenu/Registrar";
const REGISTRAR_COMMAND = "/usr/libexec/vala-panel/appmenu-registrar --reference";
const BUTTON_HORIZONTAL_PADDING = 16;
const APP_BUTTON_HORIZONTAL_PADDING = 10;
const TITLE_BUTTON_HORIZONTAL_PADDING = 8;

const RegistrarIface =
    '<node> \
        <interface name="com.canonical.AppMenu.Registrar"> \
            <method name="RegisterWindow"> \
                <arg type="u" name="windowId" direction="in" /> \
                <arg type="o" name="menuObjectPath" direction="in" /> \
            </method> \
            <method name="UnregisterWindow"> \
                <arg type="u" name="windowId" direction="in" /> \
            </method> \
            <method name="GetMenuForWindow"> \
                <arg type="u" name="windowId" direction="in" /> \
                <arg type="s" name="service" direction="out" /> \
                <arg type="o" name="menuObjectPath" direction="out" /> \
            </method> \
            <method name="GetMenus"> \
                <arg type="a(uso)" name="menus" direction="out" /> \
            </method> \
            <signal name="WindowRegistered"> \
                <arg type="u" name="windowId" /> \
                <arg type="s" name="service" /> \
                <arg type="o" name="menuObjectPath" /> \
            </signal> \
            <signal name="WindowUnregistered"> \
                <arg type="u" name="windowId" /> \
            </signal> \
        </interface> \
    </node>';

const RegistrarProxy = Gio.DBusProxy.makeProxyWrapper(RegistrarIface);

const GtkMenusIface =
    '<node> \
        <interface name="org.gtk.Menus"> \
            <method name="Start"> \
                <arg type="au" name="groups" direction="in" /> \
                <arg type="a(uuaa{sv})" name="content" direction="out" /> \
            </method> \
            <method name="End"> \
                <arg type="au" name="groups" direction="in" /> \
            </method> \
            <signal name="Changed"> \
                <arg type="a(uuuuaa{sv})" name="changes" /> \
            </signal> \
        </interface> \
    </node>';

const GtkActionsIface =
    '<node> \
        <interface name="org.gtk.Actions"> \
            <method name="Activate"> \
                <arg type="s" name="action_name" direction="in" /> \
                <arg type="av" name="parameter" direction="in" /> \
                <arg type="a{sv}" name="platform_data" direction="in" /> \
            </method> \
            <method name="DescribeAll"> \
                <arg type="a{s(bgav)}" name="descriptions" direction="out" /> \
            </method> \
        </interface> \
    </node>';

const GtkMenusProxy = Gio.DBusProxy.makeProxyWrapper(GtkMenusIface);
const GtkActionsProxy = Gio.DBusProxy.makeProxyWrapper(GtkActionsIface);

function spawn(command) {
    try {
        Util.spawnCommandLine(command);
    } catch (e) {
        global.logError("Global Menu command failed: " + command + ": " + e);
    }
}

function textOr(value, fallback) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    return String(value);
}

function stripMnemonic(label) {
    return textOr(label, "").replace(/_([^_])/, "$1").replace(/__/g, "_");
}

class GlobalMenuApplet extends Applet.Applet {
    constructor(orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);
        this.actor.set_style_class_name("global-menu");
        this._appletPanelHeight = panelHeight;

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind("show-system-menu", "showSystemMenu", this._onSettingsChanged);
        this.settings.bind("system-menu-logo", "systemMenuLogo", this._onSettingsChanged);
        this.settings.bind("system-menu-logo-size", "systemMenuLogoSize", this._onSettingsChanged);
        this.settings.bind("app-name-overrides", "appNameOverrides", this._onSettingsChanged);
        this.settings.bind("system-menu-items", "systemMenuItems", this._onSettingsChanged);
        this.settings.bind("show-window-title", "showWindowTitle", this._onSettingsChanged);
        this.settings.bind("show-no-exported-menu", "showNoExportedMenu", this._onSettingsChanged);
        this.settings.bind("menu-width", "menuWidth", this._onSettingsChanged);

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._session = new GnomeSession.SessionManager();
        this._screenSaverProxy = new ScreenSaver.ScreenSaverProxy();

        this._focusedWindow = null;
        this._focusedXid = 0;
        this._lastLoadedXid = 0;
        this._pendingFocusRefreshId = 0;
        this._menuInteractionUntil = 0;
        this._activeMenuSourceActor = null;
        this._activeGtkMenuKey = null;
        this._revealMenuId = 0;
        this._titleMarqueeId = 0;
        this._focusChangedId = 0;
        this._titleChangedId = 0;
        this._registrarSignals = [];
        this._nameOwnerSignalId = 0;
        this._startedRegistrar = false;
        this._client = null;
        this._factory = null;
        this._windowTracker = Cinnamon.WindowTracker.get_default();
        this._appSystem = Cinnamon.AppSystem.get_default();
        this._gtkMenusProxy = null;
        this._gtkActionsProxy = null;
        this._gtkUnityActionsProxy = null;
        this._gtkWindowActionsProxy = null;
        this._gtkAppActionsProxy = null;
        this._gtkChangedId = 0;
        this._gtkTopItems = [];
        this._gtkSubmenuCache = {};
        this._rootSignalIds = [];
        this._refreshLabelsId = 0;
        this._hasExportedMenu = false;
        this._recentApplications = [];

        this._buildActor();
        this._installFallbackMenu();
        this._connectRegistrar(true);

        this._focusChangedId = global.display.connect("notify::focus-window", Lang.bind(this, this._onFocusChanged));
        this._onSettingsChanged();
        this._onFocusChanged();
    }

    _buildActor() {
        this.systemButton = this._makeCenterButton("global-menu-system global-menu-item");
        this.appButton = this._makeButton("global-menu-app global-menu-item", _("Desktop"), APP_BUTTON_HORIZONTAL_PADDING);
        this.appLabel = this.appButton._label;
        this.staticBox = new St.BoxLayout({ vertical: false, style_class: "global-menu-static", y_expand: true });
        this.dynamicBox = new St.BoxLayout({ vertical: false, style_class: "global-menu-dynamic", y_expand: true });
        this.dynamicBox.visible = false;
        this.titleClip = new Cinnamon.GenericContainer({
            style_class: "global-menu-title-clip",
            clip_to_allocation: true,
            reactive: true,
            track_hover: true,
            x_expand: true
        });
        this.titleLabel = this._makeLabel("global-menu-title", "");
        this.titleLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

        this.staticBox.add_actor(this.systemButton);
        this.staticBox.add_actor(this.appButton);
        this.actor.add(this.staticBox, { y_fill: true, y_align: St.Align.MIDDLE });
        this.actor.add(this.dynamicBox, { y_fill: true, y_align: St.Align.MIDDLE });
        this.titleClip.add_actor(this.titleLabel);
        this.titleClip.connect("get-preferred-width", Lang.bind(this, this._titleClipGetPreferredWidth));
        this.titleClip.connect("get-preferred-height", Lang.bind(this, this._titleClipGetPreferredHeight));
        this.titleClip.connect("allocate", Lang.bind(this, this._titleClipAllocate));
        this.actor.add(this.titleClip, { y_fill: true, y_align: St.Align.MIDDLE });

        this.systemButton.connect("clicked", Lang.bind(this, function (actor) {
            return this._openSystemMenu(actor);
        }));

        this.appButton.connect("clicked", Lang.bind(this, function (actor) {
            return this._openAppControlsMenu(actor);
        }));

        this.titleClip.connect("enter-event", Lang.bind(this, this._startTitleMarquee));
        this.titleClip.connect("leave-event", Lang.bind(this, this._returnTitleMarquee));
        this.titleClip.connect("button-press-event", function () {
            return Clutter.EVENT_STOP;
        });
        this.titleClip.connect("button-release-event", function () {
            return Clutter.EVENT_STOP;
        });
    }

    _makeCenterButton(styleClass) {
        let button = new St.Button({
            style_class: styleClass,
            reactive: true,
            track_hover: true,
            can_focus: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE,
            y_expand: true
        });
        button.height = this._buttonHeight();
        button._fixedWidth = 0;
        button._horizontalPadding = 0;
        button._centerChild = null;
        button._naturalChildWidth = 0;
        button._needsFixedWidth = false;
        button.connect("notify::mapped", Lang.bind(this, function (actor) {
            if (actor._needsFixedWidth) {
                this._updateButtonFixedWidth(actor);
            }
        }));
        return button;
    }

    _setCenterButtonChild(button, child) {
        button._centerChild = child || null;
        button._naturalChildWidth = 0;
        button.set_child(child || null);
    }

    _updateSystemMenuLogo() {
        this._setCenterButtonChild(this.systemButton, null);
        this.systemButton.visible = this.showSystemMenu;

        let logo = this.systemMenuLogo || "distributor";
        let size = Math.max(10, Math.min(28, this.systemMenuLogoSize || 16));
        let buttonSize = Math.max(20, size + 6);
        this.systemButton._fixedWidth = buttonSize;
        this.systemButton.width = buttonSize;
        this.systemButton.min_width = buttonSize;
        this.systemButton.height = this._buttonHeight();

        if (logo === "distributor") {
            let label = this._makeLabel("global-menu-system-symbol", "");
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            this._centerLabelText(label);
            label.style = "font-size: " + size + "px;";
            this._setCenterButtonChild(this.systemButton, label);
            return;
        }

        if (logo === "text") {
            let label = this._makeLabel("global-menu-system-symbol", "System");
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            this._centerLabelText(label);
            label.style = "font-size: " + size + "px;";
            this.systemButton._fixedWidth = Math.max(34, size * 3 + 8);
            this.systemButton.width = this.systemButton._fixedWidth;
            this.systemButton.min_width = this.systemButton._fixedWidth;
            this._setCenterButtonChild(this.systemButton, label);
            return;
        }

        let iconName = "start-here-symbolic";
        if (logo === "mint") {
            iconName = "start-here-symbolic";
        } else if (logo === "cinnamon") {
            iconName = "cinnamon-symbolic";
        }

        let icon = new St.Icon({
            icon_name: iconName,
            icon_type: St.IconType.SYMBOLIC,
            icon_size: size,
            style_class: "global-menu-system-icon"
        });
        this._setCenterButtonChild(this.systemButton, icon);
    }

    _makeLabel(styleClass, text) {
        let label = new St.Label({
            style_class: styleClass || "",
            text: text,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE,
            x_expand: true,
            y_expand: true
        });
        label.clutter_text.set_single_line_mode(true);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        return label;
    }

    _centerLabelText(label) {
        label.x_align = St.Align.MIDDLE;
        label.x_expand = true;
        if (label.clutter_text.set_line_alignment) {
            label.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
        }
    }

    _makeButton(styleClass, text, horizontalPadding) {
        let button = this._makeCenterButton(styleClass);
        button._horizontalPadding = horizontalPadding !== undefined ? horizontalPadding : BUTTON_HORIZONTAL_PADDING;
        let label = this._makeLabel("", text);
        this._centerLabelText(label);
        this._setCenterButtonChild(button, label);
        button._label = label;
        button._needsFixedWidth = true;
        return button;
    }

    _updateButtonFixedWidth(button) {
        if (!button || !button._centerChild) {
            return;
        }

        if (!button.get_stage()) {
            button._naturalChildWidth = 0;
            button._needsFixedWidth = true;
            return;
        }

        let [, naturalWidth] = button._centerChild.get_preferred_width(-1);
        button._naturalChildWidth = naturalWidth;
        button._fixedWidth = Math.ceil(naturalWidth + (button._horizontalPadding || 0));
        button.width = button._fixedWidth;
        button.min_width = button._fixedWidth;
        button._needsFixedWidth = false;
    }

    _buttonHeight() {
        return Math.max(1, Math.floor((this._appletPanelHeight || this.actor.height || 24) / global.ui_scale));
    }

    _makeHeading(text) {
        let label = this._makeButton("global-menu-heading global-menu-item", text);
        label._label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        label.connect("clicked", Lang.bind(this, function (actor) {
            return this._toggleMenu(actor);
        }));
        return label;
    }

    _makeGtkHeading(text, item) {
        let label = this._makeButton("global-menu-heading global-menu-item", text);
        label._label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        label.connect("enter-event", Lang.bind(this, function () {
            this._prefetchGtkSubmenu(item);
            return Clutter.EVENT_PROPAGATE;
        }));
        label.connect("clicked", Lang.bind(this, function (actor) {
            this._holdCurrentMenu();
            this._openGtkSubmenu(item, actor);
            return Clutter.EVENT_STOP;
        }));
        return label;
    }

    _titleClipGetPreferredWidth(actor, forHeight, alloc) {
        let width = this.titleClip.visible ? Math.max(0, this.menuWidth || 0) * global.ui_scale : 0;
        alloc.min_size = 0;
        alloc.natural_size = width;
    }

    _titleClipGetPreferredHeight(actor, forWidth, alloc) {
        let [minHeight, naturalHeight] = this.titleLabel.get_preferred_height(forWidth);
        alloc.min_size = minHeight;
        alloc.natural_size = naturalHeight;
    }

    _titleClipAllocate(actor, box, flags) {
        let width = Math.max(0, box.x2 - box.x1);
        let height = Math.max(0, box.y2 - box.y1);
        let [, naturalWidth] = this.titleLabel.get_preferred_width(-1);
        let [, naturalHeight] = this.titleLabel.get_preferred_height(naturalWidth);
        let childBox = new Clutter.ActorBox();

        childBox.x1 = 0;
        childBox.x2 = Math.max(width, naturalWidth);
        childBox.y1 = Math.max(0, Math.floor((height - naturalHeight) / 2));
        childBox.y2 = childBox.y1 + naturalHeight;
        this.titleLabel.allocate(childBox, flags);
    }

    _setMenuSourceActor(actor) {
        if (!actor || actor.is_finalized()) {
            actor = this.actor;
        }

        this.menu.sourceActor = actor;

        if (this.menu.shiftToPosition) {
            this.menu.shiftToPosition(-1);
        } else {
            this.menu._slidePosition = -1;
        }
    }

    _toggleMenu(actor) {
        this._holdCurrentMenu();
        actor = actor || this.actor;

        if (this.menu.isOpen && this._activeMenuSourceActor === actor) {
            this._cancelPendingMenuReveal();
            this.menu.actor.opacity = 255;
            this.menu.close(false);
            this._activeMenuSourceActor = null;
            this._activeGtkMenuKey = null;
            return Clutter.EVENT_STOP;
        }

        this._setMenuSourceActor(actor);
        this._activeMenuSourceActor = actor;
        this._activeGtkMenuKey = null;
        this.menu.toggle();
        return Clutter.EVENT_STOP;
    }

    _openAppControlsMenu(actor) {
        this._holdCurrentMenu();
        actor = actor || this.appLabel || this.actor;

        if (this.menu.isOpen && this._activeMenuSourceActor === actor && this._activeGtkMenuKey === "app-controls") {
            this._cancelPendingMenuReveal();
            this.menu.actor.opacity = 255;
            this.menu.close(false);
            this._activeMenuSourceActor = null;
            this._activeGtkMenuKey = null;
            return Clutter.EVENT_STOP;
        }

        this._cancelPendingMenuReveal();
        this.menu.actor.opacity = 0;
        this._setMenuSourceActor(actor);
        this._buildAppControlsPopup();
        this._activeMenuSourceActor = actor;
        this._activeGtkMenuKey = "app-controls";

        if (!this.menu.isOpen) {
            this.menu.open(false);
        }

        this._revealMenuAtSource(actor);
        return Clutter.EVENT_STOP;
    }

    _openSystemMenu(actor) {
        this._holdCurrentMenu();
        actor = actor || this.systemButton || this.actor;

        if (this.menu.isOpen && this._activeMenuSourceActor === actor && this._activeGtkMenuKey === "system-menu") {
            this._cancelPendingMenuReveal();
            this.menu.actor.opacity = 255;
            this.menu.close(false);
            this._activeMenuSourceActor = null;
            this._activeGtkMenuKey = null;
            return Clutter.EVENT_STOP;
        }

        this._cancelPendingMenuReveal();
        this.menu.actor.opacity = 0;
        this._setMenuSourceActor(actor);
        this._buildSystemPopup();
        this._activeMenuSourceActor = actor;
        this._activeGtkMenuKey = "system-menu";

        if (!this.menu.isOpen) {
            this.menu.open(false);
        }

        this._revealMenuAtSource(actor);
        return Clutter.EVENT_STOP;
    }

    _buildSystemPopup() {
        this.menu.removeAll();

        let items = this._systemMenuItems();
        for (let i = 0; i < items.length; i++) {
            let item = items[i] || {};
            if (item.separator) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }

            if (item.action === "recent") {
                this._addRecentItemsMenu(item.label);
                continue;
            }

            let callback = this._systemMenuCallback(item);
            if (!callback) {
                continue;
            }

            let label = textOr(item.label, "");
            if (item.action === "logout" && (!label || label === "Log Out...")) {
                label = this._logOutLabel();
            }

            this._addSystemAction(label, textOr(item.icon, "application-x-executable"), callback);
        }
    }

    _addRecentItemsMenu(label) {
        let submenu = new PopupMenu.PopupSubMenuMenuItem(textOr(label, _("Recent Items")));
        this.menu.addMenuItem(submenu);

        let applications = new PopupMenu.PopupSubMenuMenuItem(_("Applications"));
        submenu.menu.addMenuItem(applications);
        this._addRecentApplications(applications.menu);

        let documents = new PopupMenu.PopupSubMenuMenuItem(_("Documents"));
        submenu.menu.addMenuItem(documents);
        this._addRecentUris(documents.menu, false);

        let servers = new PopupMenu.PopupSubMenuMenuItem(_("Servers"));
        submenu.menu.addMenuItem(servers);
        this._addRecentUris(servers.menu, true);

        submenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let clearItem = new PopupMenu.PopupMenuItem(_("Clear Menu"));
        clearItem.connect("activate", Lang.bind(this, function () {
            this._recentApplications = [];
            try {
                GLib.unlink(GLib.build_filenamev([GLib.get_home_dir(), ".local", "share", "recently-used.xbel"]));
            } catch (e) {
                global.logError(e);
            }
        }));
        submenu.menu.addMenuItem(clearItem);
    }

    _addRecentApplications(menu) {
        let added = false;
        for (let i = 0; i < this._recentApplications.length && i < 10; i++) {
            let recent = this._recentApplications[i];
            let item = new PopupMenu.PopupMenuItem(recent.name);
            item.connect("activate", Lang.bind(this, function () {
                this._launchRecentApplication(recent);
            }));
            menu.addMenuItem(item);
            added = true;
        }

        if (!added) {
            this._addEmptyRecentItem(menu);
        }
    }

    _addRecentUris(menu, serversOnly) {
        let bookmarks = this._recentBookmarks();
        let added = 0;

        for (let i = 0; i < bookmarks.length && added < 10; i++) {
            let bookmark = bookmarks[i];
            let isServer = this._isServerUri(bookmark.uri);
            if (serversOnly !== isServer) {
                continue;
            }

            let item = new PopupMenu.PopupMenuItem(bookmark.label);
            item.connect("activate", Lang.bind(this, function () {
                this._openUri(bookmark.uri);
            }));
            menu.addMenuItem(item);
            added++;
        }

        if (added === 0) {
            this._addEmptyRecentItem(menu);
        }
    }

    _addEmptyRecentItem(menu) {
        let item = new PopupMenu.PopupMenuItem(_("None"));
        item.actor.reactive = false;
        menu.addMenuItem(item);
    }

    _recentBookmarks() {
        let path = GLib.build_filenamev([GLib.get_home_dir(), ".local", "share", "recently-used.xbel"]);
        let bookmarks = [];

        try {
            let [ok, contents] = GLib.file_get_contents(path);
            if (!ok || !contents) {
                return bookmarks;
            }

            let text = imports.byteArray.toString(contents);
            let re = /<bookmark\b([^>]*)>/g;
            let match;
            while ((match = re.exec(text)) !== null) {
                let attrs = match[1] || "";
                let href = attrs.match(/\bhref="([^"]+)"/);
                if (!href || !href[1]) {
                    continue;
                }

                let uri = this._decodeXml(href[1]);
                bookmarks.push({
                    uri: uri,
                    label: this._labelForUri(uri)
                });
            }
        } catch (e) {
            global.logError(e);
        }

        return bookmarks;
    }

    _decodeXml(value) {
        return textOr(value, "")
            .replace(/&quot;/g, "\"")
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&");
    }

    _labelForUri(uri) {
        try {
            let label = Cinnamon.util_get_label_for_uri(uri);
            if (label) {
                return label;
            }
        } catch (e) {
        }

        try {
            let file = Gio.File.new_for_uri(uri);
            let basename = file.get_basename();
            if (basename) {
                return basename;
            }
        } catch (e) {
        }

        return uri;
    }

    _isServerUri(uri) {
        return /^(smb|sftp|ftp|ftps|dav|davs|ssh|afp):\/\//i.test(textOr(uri, ""));
    }

    _openUri(uri) {
        try {
            Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
        } catch (e) {
            global.logError(e);
        }
    }

    _launchRecentApplication(recent) {
        let app = null;
        try {
            app = recent.id && this._appSystem ? this._appSystem.lookup_app(recent.id) : null;
        } catch (e) {
            app = null;
        }

        try {
            if (app && app.activate) {
                app.activate();
            } else if (app && app.open_new_window) {
                app.open_new_window(-1);
            }
        } catch (e) {
            global.logError(e);
        }
    }

    _systemMenuItems() {
        if (this.systemMenuItems && this.systemMenuItems.length > 0) {
            return this.systemMenuItems;
        }

        return [];
    }

    _systemMenuCallback(item) {
        let action = textOr(item.action, "").toLowerCase();
        let command = textOr(item.command, "");

        if (command) {
            return function () {
                Util.spawnCommandLine(command);
            };
        }

        if (action === "about") {
            return function () {
                Util.spawnCommandLine("cinnamon-settings info");
            };
        }
        if (action === "settings") {
            return function () {
                Util.spawnCommandLine("cinnamon-settings");
            };
        }
        if (action === "appstore") {
            return function () {
                Util.spawnCommandLine("mintinstall");
            };
        }
        if (action === "forcequit") {
            return function () {
                Util.spawnCommandLine("xkill");
            };
        }
        if (action === "sleep") {
            return function () {
                Util.spawnCommandLine("systemctl suspend");
            };
        }
        if (action === "restart") {
            return function () {
                Util.spawnCommandLine("systemctl reboot");
            };
        }
        if (action === "shutdown") {
            return Lang.bind(this, function () {
                this._session.ShutdownRemote();
            });
        }
        if (action === "lock") {
            return Lang.bind(this, this._lockScreen);
        }
        if (action === "logout") {
            return Lang.bind(this, function () {
                this._session.LogoutRemote(0);
            });
        }

        return null;
    }

    _logOutLabel() {
        let userName = GLib.get_real_name();
        if (!userName || userName === "Unknown") {
            userName = GLib.get_user_name();
        }

        return _("Log Out") + " " + userName + "...";
    }

    _addSystemAction(label, iconName, callback) {
        let item = new PopupMenu.PopupIconMenuItem(label, iconName, St.IconType.SYMBOLIC);
        item.connect("activate", Lang.bind(this, function () {
            this._holdCurrentMenu();
            callback();
        }));
        this.menu.addMenuItem(item);
        return item;
    }

    _lockScreen() {
        let screensaverSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.screensaver" });
        if (GLib.find_program_in_path("cinnamon-screensaver-command")) {
            if (screensaverSettings.get_boolean("ask-for-away-message")) {
                Util.spawnCommandLine("cinnamon-screensaver-lock-dialog");
            } else {
                Util.spawnCommandLine("cinnamon-screensaver-command --lock");
            }
        } else {
            this._screenSaverProxy.LockRemote("");
        }
    }

    _buildAppControlsPopup() {
        this.menu.removeAll();

        let window = this._focusedWindow;
        let isDesktop = this._isDesktopWindow(window);
        let appName = window && !isDesktop ? this._displayNameForWindow(window) : this._displayNameForDesktop();
        let header = new PopupMenu.PopupMenuItem(appName);
        header.actor.reactive = false;
        this.menu.addMenuItem(header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (!window || isDesktop) {
            let item = new PopupMenu.PopupMenuItem(_("No focused window"));
            item.actor.reactive = false;
            this.menu.addMenuItem(item);
            return;
        }

        let fullscreenLabel = this._isWindowFullscreen(window) ? _("Exit Full Screen") : _("Full Screen");
        this._addWindowAction(fullscreenLabel, Lang.bind(this, function () {
            this._toggleFocusedFullscreen();
        }));

        let minimizeItem = this._addWindowAction(_("Minimize"), Lang.bind(this, function () {
            if (this._focusedWindow && this._focusedWindow.minimize) {
                this._focusedWindow.minimize();
            }
        }));
        if (window.can_minimize && !window.can_minimize()) {
            minimizeItem.setSensitive(false);
        }

        let maximizeLabel = window.get_maximized && window.get_maximized() ? _("Restore") : _("Maximize");
        let maximizeItem = this._addWindowAction(maximizeLabel, Lang.bind(this, function () {
            if (!this._focusedWindow) {
                return;
            }

            if (this._focusedWindow.get_maximized && this._focusedWindow.get_maximized()) {
                this._focusedWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            } else {
                this._focusedWindow.maximize(Meta.MaximizeFlags.BOTH);
            }
        }));
        if (window.can_maximize && !window.can_maximize()) {
            maximizeItem.setSensitive(false);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let closeItem = this._addWindowAction(_("Close"), Lang.bind(this, function (event) {
            if (this._focusedWindow && this._focusedWindow.delete) {
                this._focusedWindow.delete(this._eventTime(event));
            }
        }));
        if (window.can_close && !window.can_close()) {
            closeItem.setSensitive(false);
        }
    }

    _addWindowAction(label, callback) {
        let item = new PopupMenu.PopupMenuItem(label);
        item.connect("activate", Lang.bind(this, function (menuItem, event) {
            this._holdCurrentMenu();
            callback(event);
        }));
        this.menu.addMenuItem(item);
        return item;
    }

    _eventTime(event) {
        if (event && event.get_time) {
            return event.get_time();
        }

        return global.get_current_time ? global.get_current_time() : Clutter.CURRENT_TIME;
    }

    _isWindowFullscreen(window) {
        if (!window) {
            return false;
        }

        try {
            if (window.is_fullscreen) {
                return window.is_fullscreen();
            }
        } catch (e) {
            global.logError(e);
        }

        return !!window.fullscreen;
    }

    _toggleFocusedFullscreen() {
        let window = this._focusedWindow;
        if (!window) {
            return;
        }

        if (this._isWindowFullscreen(window)) {
            if (window.unmake_fullscreen) {
                window.unmake_fullscreen();
            }
        } else if (window.make_fullscreen) {
            window.make_fullscreen();
        }
    }

    _connectRegistrar(subscribeNameOwner) {
        try {
            if (!this._startedRegistrar && GLib.file_test("/usr/libexec/vala-panel/appmenu-registrar", GLib.FileTest.EXISTS)) {
                spawn(REGISTRAR_COMMAND);
                this._startedRegistrar = true;
            }

            this._disconnectRegistrarSignals();
            this._registrar = new RegistrarProxy(Gio.DBus.session, REGISTRAR_BUS, REGISTRAR_PATH,
                Lang.bind(this, function (proxy, error) {
                    if (error) {
                        if (!this._hasExportedMenu) {
                            this._setNoExportedMenu(_("AppMenu service not running"));
                        }
                        return;
                    }

                    this._registrarSignals.push(this._registrar.connectSignal("WindowRegistered",
                        Lang.bind(this, this._onWindowRegistered)));
                    this._registrarSignals.push(this._registrar.connectSignal("WindowUnregistered",
                        Lang.bind(this, this._onWindowUnregistered)));
                    this._requestMenuForFocus();
                }));

            if (subscribeNameOwner && !this._nameOwnerSignalId) {
                this._nameOwnerSignalId = Gio.DBus.session.signal_subscribe(
                    "org.freedesktop.DBus",
                    "org.freedesktop.DBus",
                    "NameOwnerChanged",
                    "/org/freedesktop/DBus",
                    REGISTRAR_BUS,
                    Gio.DBusSignalFlags.NONE,
                    Lang.bind(this, this._onRegistrarOwnerChanged));
            }
        } catch (e) {
            global.logError(e);
            if (!this._hasExportedMenu) {
                this._setNoExportedMenu(_("AppMenu service not running"));
            }
        }
    }

    _disconnectRegistrarSignals() {
        this._registrarSignals = [];
    }

    _onRegistrarOwnerChanged(connection, sender, path, iface, signal, params) {
        let unpacked = params.deep_unpack();
        let oldOwner = unpacked[1];
        let newOwner = unpacked[2];

        if (oldOwner && !newOwner) {
            this._registrar = null;
            if (!this._hasExportedMenu) {
                this._setNoExportedMenu(_("AppMenu service not running"));
            }
        } else if (newOwner) {
            this._connectRegistrar(false);
        }
    }

    _onWindowRegistered(proxy, sender, params) {
        let [xid, service, path] = params;
        if (xid === this._focusedXid) {
            this._loadExportedMenu(service, path);
        }
    }

    _onWindowUnregistered(proxy, sender, params) {
        let [xid] = params;
        if (xid === this._focusedXid && this._client) {
            this._disconnectClient();
            this._lastLoadedXid = 0;
            this._setNoExportedMenu(_("No exported menu"));
        }
    }

    _requestMenuForFocus() {
        if (!this._focusedXid || this._isDesktopWindow(this._focusedWindow)) {
            this._disconnectClient();
            this._lastLoadedXid = 0;
            this._hasExportedMenu = false;
            this._refreshDynamicLabels();
            return;
        }

        if (this._hasExportedMenu && this._lastLoadedXid === this._focusedXid) {
            return;
        }

        let requestXid = this._focusedXid;

        if (!this._registrar) {
            if (!this._tryLoadGtkMenuFromWindow() && !this._hasExportedMenu) {
                this._setNoExportedMenu(_("No focused app menu"));
            }
            return;
        }

        this._registrar.GetMenuForWindowRemote(this._focusedXid, Lang.bind(this, function (result, error) {
            if (requestXid !== this._focusedXid) {
                return;
            }

            if (error || !result || !result[0] || !result[1] || result[1] === "/") {
                if (!this._tryLoadGtkMenuFromWindow()) {
                    if (!this._hasExportedMenu) {
                        this._setNoExportedMenu(_("No exported menu"));
                    }
                }
                return;
            }

            this._loadExportedMenu(result[0], result[1]);
        }));
    }

    _loadExportedMenu(service, path) {
        this._disconnectClient();
        this.menu.removeAll();

        this._client = new DBusMenu.DBusClient(service, path);
        this._factory = new PopupMenu.PopupMenuFactory();
        this._factory._attachToMenu(this.menu, this._client.getRoot());
        this._hasExportedMenu = true;
        this._lastLoadedXid = this._focusedXid;
        this._watchRoot();
        this._scheduleLabelRefresh();
    }

    _tryLoadGtkMenuFromWindow() {
        if (!this._focusedXid) {
            return false;
        }

        let bus = this._readWindowProperty("_GTK_UNIQUE_BUS_NAME");
        let path = this._readWindowProperty("_GTK_MENUBAR_OBJECT_PATH") ||
                   this._readWindowProperty("_UNITY_OBJECT_PATH");
        let unityPath = this._readWindowProperty("_UNITY_OBJECT_PATH") || path;
        let windowPath = this._readWindowProperty("_GTK_WINDOW_OBJECT_PATH");
        let appPath = this._readWindowProperty("_GTK_APPLICATION_OBJECT_PATH");

        if (!bus || !path || path === "/") {
            return false;
        }

        this._loadGtkMenu(bus, path, unityPath, windowPath, appPath);
        return true;
    }

    _readWindowProperty(propName) {
        try {
            let xid = "0x" + this._focusedXid.toString(16);
            let [ok, out] = GLib.spawn_command_line_sync("xprop -id " + xid + " " + propName);
            if (!ok || !out) {
                return null;
            }

            let text = imports.byteArray.toString(out);
            let match = text.match(/= "([^"]*)"/);
            return match ? match[1] : null;
        } catch (e) {
            global.logError(e);
            return null;
        }
    }

    _loadGtkMenu(bus, path, unityPath, windowPath, appPath) {
        this._disconnectClient();
        this.menu.removeAll();
        this._hasExportedMenu = true;
        this._lastLoadedXid = this._focusedXid;
        this._gtkTopItems = [];

        this._gtkMenusProxy = new GtkMenusProxy(Gio.DBus.session, bus, path, Lang.bind(this, function (proxy, error) {
            if (error) {
                global.logWarning("Unable to load GTK menu proxy: " + error);
                if (!this._hasExportedMenu) {
                    this._setNoExportedMenu(_("No exported menu"));
                }
                return;
            }

            this._gtkChangedId = this._gtkMenusProxy.connectSignal("Changed", Lang.bind(this, function () {
                this._loadGtkRoot();
            }));
            this._loadGtkRoot();
        }));

        this._gtkActionsProxy = new GtkActionsProxy(Gio.DBus.session, bus, path, function () {});
        this._gtkUnityActionsProxy = new GtkActionsProxy(Gio.DBus.session, bus, unityPath || path, function () {});
        this._gtkWindowActionsProxy = windowPath ? new GtkActionsProxy(Gio.DBus.session, bus, windowPath, function () {}) : null;
        this._gtkAppActionsProxy = appPath ? new GtkActionsProxy(Gio.DBus.session, bus, appPath, function () {}) : null;
    }

    _loadGtkRoot() {
        if (!this._gtkMenusProxy) {
            return;
        }

        this._gtkMenusProxy.StartRemote([0], Lang.bind(this, function (result, error) {
            if (error || !result) {
                if (!this._hasExportedMenu) {
                    this._setNoExportedMenu(_("No exported menu"));
                }
                return;
            }

            let items = this._extractGtkItems(result[0], true);
            if (items.length > 0) {
                this._gtkTopItems = items;
                this._gtkSubmenuCache = {};
            }
            this._refreshDynamicLabels();
        }));
    }

    _extractGtkItems(content, topLevel) {
        let items = [];
        if (!content) {
            return items;
        }

        for (let i = 0; i < content.length; i++) {
            let entry = content[i];
            let rawItems = entry[2] || [];
            for (let j = 0; j < rawItems.length; j++) {
                let item = this._normalizeGtkItem(rawItems[j]);
                if (!item) {
                    continue;
                }

                if (topLevel && !item.submenu) {
                    continue;
                }

                items.push(item);
            }
        }

        return items;
    }

    _normalizeGtkItem(raw) {
        let label = this._gtkValue(raw["label"]);
        let submenu = this._gtkValue(raw[":submenu"]);
        let section = this._gtkValue(raw[":section"]);
        let action = this._gtkValue(raw["action"]);
        let accel = this._gtkValue(raw["accel"]);
        let target = raw["target"] || null;

        if (!label && !submenu && !section) {
            return null;
        }

        return {
            label: stripMnemonic(label || ""),
            submenu: submenu,
            section: section,
            action: action,
            target: target,
            accel: accel
        };
    }

    _gtkValue(value) {
        if (value === null || value === undefined) {
            return null;
        }

        if (value.deep_unpack) {
            return value.deep_unpack();
        }

        return value;
    }

    _prefetchGtkSubmenu(item) {
        if (!item || !item.submenu || !this._gtkMenusProxy) {
            return;
        }

        let cacheKey = item.submenu[0] + ":" + (item.submenu[1] || 0);
        if (this._gtkSubmenuCache[cacheKey]) {
            return;
        }

        let group = item.submenu[0];
        this._gtkMenusProxy.StartRemote([group], Lang.bind(this, function (result, error) {
            if (error || !result) {
                return;
            }
            this._gtkSubmenuCache[cacheKey] = result[0];
        }));
    }

    _openGtkSubmenu(item, sourceActor) {
        if (!item || !item.submenu || !this._gtkMenusProxy) {
            return;
        }

        let group = item.submenu[0];
        let section = item.submenu[1] || 0;
        let cacheKey = group + ":" + section;
        let cached = this._gtkSubmenuCache[cacheKey];
        sourceActor = sourceActor || this.actor;

        if (this.menu.isOpen &&
            this._activeGtkMenuKey === cacheKey &&
            this._activeMenuSourceActor === sourceActor) {
            this._cancelPendingMenuReveal();
            this.menu.actor.opacity = 255;
            this.menu.close(false);
            this._activeMenuSourceActor = null;
            this._activeGtkMenuKey = null;
            return;
        }

        this._setMenuSourceActor(sourceActor);

        let doOpen = Lang.bind(this, function (content) {
            let wasOpen = this.menu.isOpen;
            this._cancelPendingMenuReveal();
            this.menu.actor.opacity = 0;

            this._setMenuSourceActor(sourceActor);
            this._buildGtkPopup(item.label, content, group, section);
            this._activeMenuSourceActor = sourceActor;
            this._activeGtkMenuKey = cacheKey;

            if (wasOpen) {
                this._revealMenuAtSource(sourceActor);
            } else {
                this.menu.open(false);
                this._revealMenuAtSource(sourceActor);
            }
        });

        if (cached) {
            doOpen(cached);
        } else {
            this._gtkMenusProxy.StartRemote([group], Lang.bind(this, function (result, error) {
                if (error || !result) {
                    return;
                }
                this._gtkSubmenuCache[cacheKey] = result[0];
                doOpen(result[0]);
            }));
        }
    }

    _revealMenuAtSource(sourceActor) {
        this._cancelPendingMenuReveal();
        this._setMenuSourceActor(sourceActor || this.actor);

        this._revealMenuId = Mainloop.idle_add(Lang.bind(this, function () {
            this._revealMenuId = 0;
            if (!this.menu || !this.menu.actor || this.menu.actor.is_finalized()) {
                return false;
            }

            this._setMenuSourceActor(sourceActor || this.actor);
            let [xPos, yPos] = this.menu._calculatePosition();
            this.menu.actor.set_position(xPos, yPos);
            this.menu.actor.opacity = 255;
            return false;
        }));
    }

    _cancelPendingMenuReveal() {
        if (this._revealMenuId) {
            Mainloop.source_remove(this._revealMenuId);
            this._revealMenuId = 0;
        }
    }

    _buildGtkPopup(title, content, rootGroup, rootSection) {
        this.menu.removeAll();
        let header = new PopupMenu.PopupMenuItem(title);
        header.actor.reactive = false;
        this.menu.addMenuItem(header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._addGtkGroupToMenu(this.menu, content, rootGroup, rootSection || 0, {});
    }

    _addGtkGroupToMenu(targetMenu, content, groupId, sectionId, visited) {
        let key = String(groupId) + ":" + String(sectionId);
        if (visited[key]) {
            return false;
        }
        visited[key] = true;

        let entries = [];
        for (let i = 0; i < content.length; i++) {
            if (content[i][0] === groupId && content[i][1] === sectionId) {
                entries.push(content[i]);
            }
        }

        let added = false;
        for (let i = 0; i < entries.length; i++) {
            let rawItems = entries[i][2] || [];
            for (let j = 0; j < rawItems.length; j++) {
                let item = this._normalizeGtkItem(rawItems[j]);
                if (!item) {
                    continue;
                }

                if (item.section) {
                    let hadSectionItems = this._addGtkGroupToMenu(targetMenu, content,
                        item.section[0], item.section[1] || 0, visited);
                    if (hadSectionItems) {
                        targetMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                        added = true;
                    }
                } else if (item.submenu) {
                    this._addGtkSubmenuItem(targetMenu, item);
                    added = true;
                } else if (item.label) {
                    this._addGtkActionItem(targetMenu, item);
                    added = true;
                }
            }
        }

        return added;
    }

    _addGtkSubmenuItem(targetMenu, item) {
        let submenu = new PopupMenu.PopupSubMenuMenuItem(item.label);
        targetMenu.addMenuItem(submenu);

        if (!this._gtkMenusProxy || !item.submenu) {
            return;
        }

        let group = item.submenu[0];
        let section = item.submenu[1] || 0;
        this._gtkMenusProxy.StartRemote([group], Lang.bind(this, function (result, error) {
            if (error || !result) {
                return;
            }

            this._addGtkGroupToMenu(submenu.menu, result[0], group, section, {});
        }));
    }

    _addGtkActionItem(targetMenu, item) {
        let menuItem = new PopupMenu.PopupMenuItem(item.accel ? item.label + "\t" + item.accel : item.label);
        menuItem.connect("activate", Lang.bind(this, function () {
            this._holdCurrentMenu();
            this._activateGtkAction(item.action, item.target);
        }));
        targetMenu.addMenuItem(menuItem);
    }

    _activateGtkAction(action, target) {
        if (!action) {
            return;
        }

        let proxy = this._findGtkActionProxy(action);
        if (!proxy) {
            global.logWarning("No GTK action proxy for action: " + action);
            return;
        }

        let actionName = action.replace(/^unity\./, "").replace(/^win\./, "").replace(/^app\./, "");
        let params = this._makeGtkActionParams(target);

        proxy.ActivateRemote(actionName, params, {}, Lang.bind(this, function (result, error) {
            if (error) {
                global.logWarning("Unable to activate GTK action " + action + ": " + error);
            }
            this._scheduleFocusRefresh();
        }));
    }

    _findGtkActionProxy(action) {
        if (action.indexOf("unity.") === 0) {
            return this._gtkUnityActionsProxy || this._gtkActionsProxy;
        }

        if (action.indexOf("win.") === 0) {
            return this._gtkWindowActionsProxy || this._gtkActionsProxy;
        }

        if (action.indexOf("app.") === 0) {
            return this._gtkAppActionsProxy || this._gtkActionsProxy;
        }

        return this._gtkActionsProxy || this._gtkUnityActionsProxy || this._gtkWindowActionsProxy || this._gtkAppActionsProxy;
    }

    _makeGtkActionParams(target) {
        if (target === null || target === undefined) {
            return [];
        }

        if (!target.get_type_string) {
            target = GLib.Variant.new("s", String(target));
        }

        return [target];
    }

    _holdCurrentMenu() {
        this._menuInteractionUntil = GLib.get_monotonic_time() + 3000 * 1000;
    }

    _shouldKeepCurrentMenu() {
        return this._hasExportedMenu && GLib.get_monotonic_time() < this._menuInteractionUntil;
    }

    _watchRoot() {
        this._disconnectRootSignals();
        if (!this._client) {
            return;
        }

        let root = this._client.getRoot();
        if (!root) {
            return;
        }

        this._rootSignalIds = [
            root.connect("child-added", Lang.bind(this, this._scheduleLabelRefresh)),
            root.connect("child-moved", Lang.bind(this, this._scheduleLabelRefresh)),
            root.connect("child-removed", Lang.bind(this, this._scheduleLabelRefresh)),
            root.connect("destroy", Lang.bind(this, this._disconnectRootSignals))
        ];
    }

    _disconnectRootSignals() {
        if (!this._client || !this._rootSignalIds.length) {
            this._rootSignalIds = [];
            return;
        }

        let root = this._client.getRoot();
        if (root) {
            for (let i = 0; i < this._rootSignalIds.length; i++) {
                try {
                    root.disconnect(this._rootSignalIds[i]);
                } catch (e) {
                    global.logError(e);
                }
            }
        }

        this._rootSignalIds = [];
    }

    _scheduleLabelRefresh() {
        if (this._refreshLabelsId) {
            Mainloop.source_remove(this._refreshLabelsId);
        }

        this._refreshLabelsId = Mainloop.timeout_add(250, Lang.bind(this, function () {
            this._refreshLabelsId = 0;
            this._refreshDynamicLabels();
            return false;
        }));
    }

    _refreshDynamicLabels() {
        this.dynamicBox.destroy_all_children();

        if (!this._focusedWindow || this._isDesktopWindow(this._focusedWindow)) {
            this._applyDynamicButtonHeight();
            return;
        }

        if (this._hasExportedMenu && this._client) {
            let root = this._client.getRoot();
            let children = root ? root.getChildren() : [];
            let added = 0;

            for (let i = 0; i < children.length && added < 10; i++) {
                let child = children[i];
                if (!child || !child.isVisible()) {
                    continue;
                }

                let label = stripMnemonic(child.getLabel());
                if (!label) {
                    continue;
                }

                this.dynamicBox.add_actor(this._makeHeading(label));
                added++;
            }

            if (added > 0) {
                this._applyDynamicButtonHeight();
                return;
            }
        }

        if (this._hasExportedMenu && this._gtkTopItems.length > 0) {
            for (let i = 0; i < this._gtkTopItems.length && i < 10; i++) {
                this.dynamicBox.add_actor(this._makeGtkHeading(this._gtkTopItems[i].label, this._gtkTopItems[i]));
            }
            this._applyDynamicButtonHeight();
            return;
        }

        if (!this.showNoExportedMenu) {
            this._applyDynamicButtonHeight();
            return;
        }

        this.dynamicBox.add_actor(this._makeButton("global-menu-title global-menu-item", _("No exported menu"), TITLE_BUTTON_HORIZONTAL_PADDING));
        this._applyDynamicButtonHeight();
    }

    _applyDynamicButtonHeight() {
        let height = this._buttonHeight();
        let children = this.dynamicBox.get_children();
        this.dynamicBox.visible = children.length > 0;
        for (let i = 0; i < children.length; i++) {
            children[i].height = height;
        }
    }

    _installFallbackMenu() {
        this.menu.removeAll();
        this.headerItem = new PopupMenu.PopupMenuItem(_("Desktop"));
        this.headerItem.actor.reactive = false;
        this.menu.addMenuItem(this.headerItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        let item = new PopupMenu.PopupMenuItem(_("No exported application menu"));
        item.actor.reactive = false;
        this.menu.addMenuItem(item);
    }

    _setNoExportedMenu(status) {
        this._hasExportedMenu = false;
        this._installFallbackMenu();
        this._refreshDynamicLabels();
    }

    _disconnectClient() {
        this._disconnectRootSignals();
        this._disconnectGtkMenu();

        if (this._refreshLabelsId) {
            Mainloop.source_remove(this._refreshLabelsId);
            this._refreshLabelsId = 0;
        }

        if (this._client) {
            let root = this._client.getRoot();
            if (root) {
                if (root._shellMenuSignalsHandlers && root._disconnectSignals) {
                    root._disconnectSignals(this.menu, root._shellMenuSignalsHandlers);
                    root._shellMenuSignalsHandlers = null;
                }
                root.shellItem = null;
            }
            this._client.destroy();
            this._client = null;
        }

        this._factory = null;
        this._hasExportedMenu = false;
    }

    _disconnectGtkMenu() {
        if (this._gtkChangedId && this._gtkMenusProxy && this._gtkMenusProxy.disconnectSignal) {
            try {
                this._gtkMenusProxy.disconnectSignal(this._gtkChangedId);
            } catch (e) {
                global.logError(e);
            }
        }

        this._gtkChangedId = 0;
        this._gtkMenusProxy = null;
        this._gtkActionsProxy = null;
        this._gtkUnityActionsProxy = null;
        this._gtkWindowActionsProxy = null;
        this._gtkAppActionsProxy = null;
        this._gtkTopItems = [];
        this._gtkSubmenuCache = {};
    }

    _onSettingsChanged() {
        this.actor.natural_width_set = false;
        this._applyButtonHeights();
        this._updateSystemMenuLogo();
        this.titleClip.visible = this.showWindowTitle;
        this.titleClip.queue_relayout();
        this._refreshDynamicLabels();
        this._syncFocusLabels();
    }

    _applyButtonHeights() {
        let height = this._buttonHeight();
        this.actor.height = height;
        this.appButton.height = height;
        this.systemButton.height = height;
        this.dynamicBox.height = height;
    }

    on_panel_height_changed() {
        this._appletPanelHeight = this.panel ? this.panel.height : this._appletPanelHeight;
        this._applyButtonHeights();
        this._updateSystemMenuLogo();
        this._refreshDynamicLabels();
    }

    on_applet_clicked(event) {
        return Clutter.EVENT_STOP;
    }

    _onFocusChanged() {
        if (this._focusedWindow && this._titleChangedId) {
            try {
                this._focusedWindow.disconnect(this._titleChangedId);
            } catch (e) {
                global.logError(e);
            }
            this._titleChangedId = 0;
        }

        let previousXid = this._focusedXid;
        this._focusedWindow = global.display.focus_window || null;
        this._focusedXid = this._focusedWindow ? this._focusedWindow.get_xwindow() : 0;

        if (previousXid !== this._focusedXid) {
            this._disconnectClient();
            this._lastLoadedXid = 0;
            this._hasExportedMenu = false;
            this.menu.removeAll();
            this._installFallbackMenu();
            this._refreshDynamicLabels();
        }

        if (this._focusedWindow) {
            this._titleChangedId = this._focusedWindow.connect("notify::title", Lang.bind(this, this._syncFocusLabels));
            this._recordRecentApplication(this._focusedWindow);
        }

        this._scheduleFocusRefresh();
    }

    _scheduleFocusRefresh() {
        if (this._pendingFocusRefreshId) {
            Mainloop.source_remove(this._pendingFocusRefreshId);
        }

        this._pendingFocusRefreshId = Mainloop.timeout_add(180, Lang.bind(this, function () {
            this._pendingFocusRefreshId = 0;
            this._syncFocusLabels();
            this._requestMenuForFocus();
            return false;
        }));
    }

    _syncFocusLabels() {
        let app = _("Desktop");
        let title = "";

        if (this._focusedWindow && !this._isDesktopWindow(this._focusedWindow)) {
            app = this._displayNameForWindow(this._focusedWindow);
            title = textOr(this._focusedWindow.get_title(), "");
        } else {
            app = this._displayNameForDesktop();
        }

        this.appLabel.clutter_text.set_text(app);
        this._updateButtonFixedWidth(this.appButton);
        this.titleLabel.clutter_text.set_text(title);
        this._resetTitleMarqueeImmediate();
    }

    _isDesktopWindow(window) {
        if (!window) {
            return false;
        }

        let wmClass = textOr(window.get_wm_class ? window.get_wm_class() : "", "").toLowerCase();
        let wmInstance = textOr(window.get_wm_class_instance ? window.get_wm_class_instance() : "", "").toLowerCase();
        let title = textOr(window.get_title ? window.get_title() : "", "").toLowerCase();

        return wmClass === "nemo-desktop" ||
               wmInstance === "nemo-desktop" ||
               wmClass === "desktop" ||
               wmInstance === "desktop" ||
               title === "desktop" ||
               title === "masaüstü";
    }

    _displayNameForDesktop() {
        return this._displayNameFromOverride("nemo-desktop", "nemo-desktop", _("Desktop")) || _("Desktop");
    }

    _displayNameForWindow(window) {
        let wmClass = textOr(window.get_wm_class ? window.get_wm_class() : "", "");
        let wmInstance = textOr(window.get_wm_class_instance ? window.get_wm_class_instance() : "", "");
        let title = textOr(window.get_title ? window.get_title() : "", "");
        let override = this._displayNameFromOverride(wmClass, wmInstance, title);
        if (override) {
            return override;
        }

        let app = null;
        try {
            app = this._windowTracker ? this._windowTracker.get_window_app(window) : null;
        } catch (e) {
            app = null;
        }

        if (!app && this._appSystem) {
            try {
                app = this._appSystem.lookup_wmclass(wmClass) ||
                      this._appSystem.lookup_wmclass(wmInstance);
            } catch (e) {
                app = null;
            }
        }

        if (app && app.get_name) {
            let name = textOr(app.get_name(), "");
            if (name) {
                return name;
            }
        }

        return textOr(wmClass, textOr(wmInstance, _("Application")));
    }

    _recordRecentApplication(window) {
        if (!window || this._isDesktopWindow(window)) {
            return;
        }

        let app = null;
        try {
            app = this._windowTracker ? this._windowTracker.get_window_app(window) : null;
        } catch (e) {
            app = null;
        }

        let id = "";
        let name = this._displayNameForWindow(window);
        if (app) {
            try {
                id = app.get_id ? textOr(app.get_id(), "") : "";
            } catch (e) {
                id = "";
            }
            try {
                name = app.get_name ? textOr(app.get_name(), name) : name;
            } catch (e) {
            }
        }

        if (!name) {
            return;
        }

        let key = id || name;
        let next = [{ id: id, name: name }];
        for (let i = 0; i < this._recentApplications.length && next.length < 10; i++) {
            let old = this._recentApplications[i];
            if ((old.id || old.name) !== key) {
                next.push(old);
            }
        }
        this._recentApplications = next;
    }

    _displayNameFromOverride(wmClass, wmInstance, title) {
        let haystack = [
            textOr(wmClass, ""),
            textOr(wmInstance, ""),
            textOr(title, "")
        ].join(" ").toLowerCase();
        let overrides = this.appNameOverrides || [];

        for (let i = 0; i < overrides.length; i++) {
            let entry = overrides[i] || {};
            let match = textOr(entry.match, "").toLowerCase();
            let name = textOr(entry.name, "");
            if (match && name && haystack.indexOf(match) !== -1) {
                return name;
            }
        }

        return null;
    }

    _startTitleMarquee() {
        this._resetTitleMarqueeImmediate();

        if (!this.showWindowTitle || !this.titleClip.visible) {
            return Clutter.EVENT_STOP;
        }

        let overflow = this._getTitleOverflow();
        if (overflow <= 8) {
            return Clutter.EVENT_STOP;
        }

        this._titleMarqueeId = Mainloop.timeout_add(350, Lang.bind(this, function () {
            this._titleMarqueeId = 0;

            let overflow = this._getTitleOverflow();
            if (overflow <= 8) {
                return false;
            }

            let duration = Math.min(9000, Math.max(1600, overflow * 28));
            this.titleLabel.ease({
                translation_x: -overflow,
                duration: duration,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD
            });

            return false;
        }));

        return Clutter.EVENT_STOP;
    }

    _getTitleOverflow() {
        if (!this.titleLabel || !this.titleClip) {
            return 0;
        }

        let clipWidth = this.titleClip.width || 0;
        let [, naturalWidth] = this.titleLabel.get_preferred_width(-1);
        return naturalWidth - clipWidth;
    }

    _returnTitleMarquee() {
        if (this._titleMarqueeId) {
            Mainloop.source_remove(this._titleMarqueeId);
            this._titleMarqueeId = 0;
        }

        if (!this.titleLabel) {
            return Clutter.EVENT_STOP;
        }

        let currentOffset = Math.abs(this.titleLabel.translation_x || 0);
        if (currentOffset <= 1 || this._getTitleOverflow() <= 8) {
            this._resetTitleMarqueeImmediate();
            return Clutter.EVENT_STOP;
        }

        if (this.titleLabel.remove_all_transitions) {
            this.titleLabel.remove_all_transitions();
        }

        this.titleLabel.ease({
            translation_x: 0,
            duration: Math.min(1800, Math.max(450, currentOffset * 18)),
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD
        });

        return Clutter.EVENT_STOP;
    }

    _resetTitleMarqueeImmediate() {
        if (this._titleMarqueeId) {
            Mainloop.source_remove(this._titleMarqueeId);
            this._titleMarqueeId = 0;
        }

        if (this.titleLabel && this.titleLabel.remove_all_transitions) {
            this.titleLabel.remove_all_transitions();
        }

        if (this.titleLabel) {
            this.titleLabel.translation_x = 0;
        }

        return Clutter.EVENT_STOP;
    }

    on_applet_removed_from_panel() {
        this._disconnectClient();

        if (this._nameOwnerSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerSignalId);
            this._nameOwnerSignalId = 0;
        }

        this._disconnectRegistrarSignals();
        this._registrar = null;

        if (this._focusChangedId) {
            global.display.disconnect(this._focusChangedId);
            this._focusChangedId = 0;
        }

        if (this._pendingFocusRefreshId) {
            Mainloop.source_remove(this._pendingFocusRefreshId);
            this._pendingFocusRefreshId = 0;
        }

        if (this._titleMarqueeId) {
            Mainloop.source_remove(this._titleMarqueeId);
            this._titleMarqueeId = 0;
        }

        if (this._focusedWindow && this._titleChangedId) {
            this._focusedWindow.disconnect(this._titleChangedId);
            this._titleChangedId = 0;
        }

        this.settings.finalize();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new GlobalMenuApplet(orientation, panelHeight, instanceId);
}
