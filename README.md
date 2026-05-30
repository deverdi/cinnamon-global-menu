<p align="center">
  <a href="#-tr-türkçe">🇹🇷 Türkçe</a> • 
  <a href="#-en-english">🇺🇸 English</a>
</p>

---

# 🇹🇷 TR: Türkçe

## 🌐 Global Menu — Cinnamon Applet

Cinnamon masaüstü ortamı için geliştirilmiş, aktif pencerenin menü çubuğunu (File, Edit, View vb.) doğrudan panele taşıyan kompakt ve modern bir **Global Menu** uygulamacığıdır.

Bu applet, **AppMenu Registrar** aracılığıyla uygulamaların DBusMenu veya GTK Menus protokolleri üzerinden dışa aktardığı menüleri yakalar ve Cinnamon panelinizde şık bir şekilde listeler.

### 📸 Ekran Görüntüsü

<p align="center">
  <img src="screenshot.png" alt="Global Menu Screenshot" width="800">
</p>

---

### ✨ Özellikler

*   **💻 Dinamik Uygulama Menüleri:** Odaktaki uygulamanın menü çubuğunu (Dosya, Düzenle, Görünüm vb.) panelde gösterir.
*   **⚙️ Sistem Menüsü:** Panel üzerinden Hakkında, Ayarlar, Ekranı Kilitle ve Kapat gibi sistem işlemlerine hızlı erişim sağlar.
*   **🪟 Pencere Kontrolleri:** Aktif pencereyi tam ekran yapma, simge durumuna küçültme, büyütme ve kapatma butonları.
*   **⏳ Son Öğeler:** Son kullanılan uygulamalara ve belgelere hızlıca göz atın ve açın.
*   **✏️ Uygulama Adı Özelleştirme:** WM sınıfına (WM_CLASS) göre panelde gösterilen uygulama adlarını dilediğiniz gibi maskeleyin veya değiştirin.

---

### 🚀 Gereksinimler & Ön Hazırlık

Menülerin panele doğru şekilde aktarılabilmesi için sisteminizde gerekli modüllerin kurulu olması gerekir.

#### 1. Gerekli Paketlerin Kurulumu
```bash
sudo apt install appmenu-registrar appmenu-gtk3-module appmenu-gtk2-module
