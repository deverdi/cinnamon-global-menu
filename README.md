# Global Menu — Cinnamon Applet

GTK/Qt uygulamalarının menü çubuğunu Cinnamon panelinde göstermek için kompakt bir global-menu applet'i.

AppMenu Registrar üzerinden uygulamaların kendi menülerini (DBusMenu / GTK Menus) panele taşır.

## Özellikler

- **Uygulama menüleri** — Odaktaki uygulamanın menü çubuğunu panelde gösterir (File, Edit, View vb.)
- **Sistem menüsü** — Panel üzerinden Hakkında, Ayarlar, Kilit, Kapat gibi sistem işlemlerine hızlı erişim
- **Pencere kontrolleri** — Tam ekran, simge durumuna küçült, büyüt, kapat
- **Son öğeler** — Son kullanılan uygulama ve belgelere hızlı erişim
- **Uygulama adı özelleştirme** — WM sınıfına göre gösterilen uygulama adını değiştirebilme

## Gereksinimler

```bash
sudo apt install appmenu-registrar appmenu-gtk3-module appmenu-gtk2-module
```

GTK menülerin dışa aktarılması için `~/.config/environment.d/80-appmenu.conf`:

```text
GTK_MODULES=appmenu-gtk-module
UBUNTU_MENUPROXY=1
```

## Kurulum

```bash
git clone https://github.com/deverdi/global-menu cinnamon-applet
cp -r global-menu@deverdi ~/.local/share/cinnamon/applets/
```

Ardından Cinnamon'u yeniden başlatın (Alt+F2 → `r`). Applet'i panele eklemek için Panel Ayarları → Uygulamacıklar → Global Menu.

## Lisans

Bu proje [GNU General Public License v3.0](LICENSE) ile lisanslanmıştır.

---

© 2026 deverdi — Tüm hakları saklıdır.
