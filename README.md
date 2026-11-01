# Chez Moi Karaköy

Chez Moi'nin web sitesi ve menü yönetim paneli. İçerik ve fotoğraflar mevcut siteden (chezmoikarakoy.com) alındı.

## Çalıştırma

Node 20 veya üstü gerekir.

```bash
npm install
npm start
```

- Site: http://localhost:3000
- Menü yönetimi: http://localhost:3000/admin

İlk açılışta sunucu bir yönetim şifresi üretir ve `.env` dosyasına `ADMIN_PASSWORD=...` olarak yazar. Şifreyi değiştirmek için bu satırı düzenleyip sunucuyu yeniden başlatın. `.env` dosyasını kimseyle paylaşmayın ve git'e eklemeyin.

## Menü

- Menü `data/menu.json` dosyasında durur. Panelden yapılan her değişiklik bu dosyaya yazılır ve bir önceki hâli `data/menu.backup.json` olarak saklanır.
- Sitedeki menü her istekte bu dosyadan üretilir, yani panelde kaydedilen değişiklik sayfa yenilenince sitede görünür.
- Panelde: ürün ekleme, adı/açıklamayı/fiyatı/kategoriyi değiştirme, silme (7 saniye içinde "Geri al"), arama; kategori ekleme, yeniden adlandırma, sıralama ve boş kategoriyi silme.
- Oturum 12 saat geçerlidir ve sunucu yeniden başlasa da kapanmaz. Şifre değişirse tüm oturumlar kapanır.

## Yayın (Render)

Site Render'da, GitHub reposuna bağlı olarak çalışır; `main` dalına her push'ta yeniden yayınlanır. Ayarlar `render.yaml` dosyasındadır.

1. https://dashboard.render.com adresinde GitHub ile giriş yapın.
2. **New → Blueprint** seçin ve `kufuank/chez-moi-karakoy` reposunu bağlayın. Render `render.yaml`'ı okur.
3. Sizden `GITHUB_TOKEN` istenir. GitHub'da **Settings → Developer settings → Fine-grained tokens → Generate new token** ile bir anahtar oluşturun:
   - Repository access: yalnızca `chez-moi-karakoy`
   - Permissions → Repository permissions → **Contents: Read and write**
4. **Apply** deyin. Yayın birkaç dakika sürer; adres `https://chez-moi-karakoy.onrender.com` gibi olur.
5. Panel şifresi Render'da otomatik üretilir: servis → **Environment** → `ADMIN_PASSWORD`.

**Menü nasıl saklanır?** Panelde yapılan her kayıt, repodaki `menu-data` dalına bir commit olarak yazılır (dal ilk açılışta otomatik oluşturulur). Sunucu her açılışta menüyü bu daldan okur. Böylece yeniden yayında ya da sunucu uyuyup uyandığında değişiklikler kaybolmaz ve kayıt yeni bir yayın tetiklemez. GitHub'a yazılamazsa kayıt yapılmaz ve panel bunu söyler.

Ücretsiz planda sunucu 15 dakika boşta kalınca uyur; sonraki ilk ziyaret yaklaşık 30 saniye sürer.

## Yapı

- `server.js` — Express sunucusu, menü API'si, giriş/oturum ve sayfaların üretilmesi
- `views/layout.html` — tüm sayfaların ortak iskeleti (üst menü, altbilgi)
- `views/home.html`, `hakkimizda.html`, `menu.html`, `galeri.html`, `iletisim.html` — sayfalar
  - `{{MENU}}` tam menüyü, `{{DISH:i036}}` gibi bir yer tutucu o ürünün adını ve güncel fiyatını basar
- `public/css/site.css`, `public/js/site.js` — stil ve hareket (GSAP + Lenis)
- `public/scenes/` — kaydırma sahneleri altyapısı (taste-skill)
- `public/admin/` — yönetim paneli
- `public/img/` — siteden alınan fotoğraflar (`img/src/` orijinalleri)
  - `img/cut/` — arka planı silinmiş (dekupe) PNG'ler: tabaklar, güveç, bina
  - `img/torn/` — yırtık kâğıt kenarlı fotoğraf baskıları
