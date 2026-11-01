# Chez Moi Karaköy

Chez Moi'nin web sitesi (restoran ve kulüp) ve yönetim paneli. İçerik ve fotoğraflar mevcut siteden (chezmoikarakoy.com) ve Instagram'dan (@chezmoikarakoy) alındı.

## Sayfalar

| Adres | İçerik |
| --- | --- |
| `/` | Giriş: **Restoran mı, kulüp mü?** |
| `/restoran` | Restoranın anasayfası |
| `/hakkimizda`, `/menu`, `/galeri`, `/iletisim` | Restoran sayfaları |
| `/rezervasyon` | Restoran rezervasyon formu |
| `/kulup` | Kulüp: yaklaşan geceler, bilet ya da ön kayıt, gecelerden kareler |
| `/gizlilik` | Kişisel veriler (aydınlatma metni taslağı) |
| `/admin` | Yönetim paneli |

## Çalıştırma

Node 20 veya üstü gerekir.

```bash
npm install
npm start
```

İlk açılışta sunucu bir yönetim şifresi üretir ve `.env` dosyasına `ADMIN_PASSWORD=...` olarak yazar. Şifreyi değiştirmek için bu satırı düzenleyip sunucuyu yeniden başlatın. `.env` dosyasını kimseyle paylaşmayın ve git'e eklemeyin.

## Yönetim paneli

- **Menü:** ürün ekleme, adı/açıklamayı/fiyatı/kategoriyi değiştirme, silme (7 saniye içinde "Geri al"), arama; kategori ekleme, yeniden adlandırma, sıralama ve boş kategoriyi silme.
- **Etkinlikler:** kulüp geceleri. Ad, tarih, saat, kat (zemin kat / roof bar), tür, sanatçılar, açıklama, afiş. Giriş için:
  - **Bilet linki** girilirse sitede "Bilet al" butonu çıkar (Biletix, Passo, Bubilet…; ödeme sitede alınmaz).
  - Link yoksa ve "ön kayıt al" işaretliyse sitede **ön kayıt** formu açılır; isteğe bağlı kapasite dolunca liste kapanır.
  - "Sitede yayınla" işaretli değilse etkinlik taslak olarak kalır.
- **Rezervasyonlar:** gelen talepler; durum (Yeni / Onaylandı / İptal), arama linki, CSV indirme, silme.
- **Ön kayıtlar:** her etkinliğin listesi; durum (Bekliyor / Onaylandı / Geldi / İptal), kişi sayısı / kapasite, CSV, silme.
- Oturum 12 saat geçerlidir ve sunucu yeniden başlasa da kapanmaz. Şifre değişirse tüm oturumlar kapanır.

## Veriler nerede durur?

- **Menü ve etkinlikler** (`data/menu.json`, `data/events.json`) ile **afişler**: panelde her kayıt, repodaki `menu-data` dalına bir commit olarak yazılır. Sunucu her açılışta bunları bu daldan okur; yeniden yayında ya da sunucu uyuyunca kaybolmaz.
- **Rezervasyon ve ön kayıtlar** (isim, telefon): kişisel veri oldukları için GitHub'a yazılmaz, **Supabase** veri tabanında durur. Tarihinden 90 gün sonra sunucu tarafından kendiliğinden silinir (gizlilik sayfasında söylendiği gibi). Supabase ayarlanmamışsa (yerelde) `data/private/` klasörüne yazılır; bu klasör git'e girmez.

## Yayın (Render)

Site Render'da, GitHub reposuna bağlı olarak çalışır; `main` dalına her push'ta yeniden yayınlanır. Ayarlar `render.yaml` dosyasındadır. Render'daki ortam değişkenleri:

| Değişken | Ne için |
| --- | --- |
| `ADMIN_PASSWORD` | Panel şifresi (Render üretir: servis → Environment) |
| `GITHUB_TOKEN` | Menü/etkinlik kaydı. GitHub → Settings → Developer settings → Fine-grained tokens; yalnızca bu repo, **Contents: Read and write** |
| `SUPABASE_URL` | Supabase proje adresi (`https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Supabase **service_role / secret** anahtarı. Yalnızca sunucuda durur, tarayıcıya gitmez |

**Supabase kurulumu:** projede SQL Editor'ü açın, `supabase/schema.sql` dosyasının içeriğini çalıştırın, sonra yukarıdaki iki değişkeni Render'a girin. Tablolarda satır güvenliği (RLS) açıktır ve hiçbir herkese açık izin yoktur; verilere yalnızca sunucu erişir.

Ücretsiz planda sunucu 15 dakika boşta kalınca uyur; sonraki ilk ziyaret yaklaşık 30 saniye sürer.

## Yapı

- `server.js` — Express sunucusu: giriş/oturum, menü API'si, sayfaların üretilmesi
- `lib/club.js` — etkinlikler, rezervasyon ve ön kayıt formları, doğrulama, panel uçları
- `lib/github-store.js` — menü/etkinlik/afişlerin GitHub dalına yansıtılması
- `lib/records.js` — kişisel verilerin Supabase'e (ya da yerelde dosyaya) yazılması
- `views/gate.html` — giriş sayfası; `views/layout.html` — diğer sayfaların ortak iskeleti
- `views/*.html` — sayfalar. Yer tutucular: `{{MENU}}`, `{{DISH:i036}}` (ürün adı + güncel fiyat), `{{EVENTS}}`, `{{ARTISTS}}`, `{{PAST_EVENTS}}`
- `public/css/site.css`, `public/css/club.css`, `public/js/site.js` — stil ve hareket (GSAP + Lenis)
- `public/admin/` — yönetim paneli (`admin.js` menü, `admin-club.js` diğer sekmeler)
- `public/img/` — fotoğraflar; `cut/` dekupe PNG'ler, `torn/` yırtık kâğıt baskılar, `ig/` Instagram görselleri
- `supabase/schema.sql` — rezervasyon ve ön kayıt tabloları
