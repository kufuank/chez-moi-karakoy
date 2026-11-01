# Chez Moi Karaköy

Chez Moi'nin web sitesi (restoran ve kulüp) ve yönetim paneli. Site **GitHub Pages**'te statik olarak yayınlanır; menü, etkinlikler, rezervasyonlar ve ön kayıtlar **Supabase**'de durur. İçerik ve fotoğraflar mevcut siteden (chezmoikarakoy.com) ve Instagram'dan (@chezmoikarakoy) alındı.

## Sayfalar

| Adres | İçerik |
| --- | --- |
| `/` | Giriş: **Restoran mı, kulüp mü?** |
| `/restoran/` | Restoranın anasayfası |
| `/hakkimizda/`, `/menu/`, `/galeri/`, `/iletisim/` | Restoran sayfaları |
| `/rezervasyon/` | Restoran rezervasyon formu |
| `/kulup/` | Kulüp: yaklaşan geceler, bilet ya da ön kayıt, gecelerden kareler |
| `/gizlilik/` | Kişisel veriler (aydınlatma metni taslağı) |
| `/admin/` | Yönetim paneli |

## Nasıl çalışır?

- `npm run build` sayfaları `views/` klasöründen `dist/` klasörüne hazır HTML olarak yazar. Menü ve etkinlikler bu sırada Supabase'den okunup sayfaya yazılır (arama motorları ve JavaScript'siz ziyaretçiler için).
- Sayfa açılınca `public/js/live.js` aynı verileri Supabase'den canlı çeker; panelde yapılan değişiklik yeniden yayın gerekmeden sitede görünür.
- Rezervasyon ve ön kayıt formları doğrudan tabloya yazamaz; Supabase'deki `chezmoi_reserve` ve `chezmoi_guestlist_signup` fonksiyonları doğrular (telefon, tarih, kapasite, aynı numara), aynı adresten 10 dakikada 6'dan fazla gönderimi reddeder ve 90 günü geçen kişisel verileri siler.
- Kim neyi okuyup yazabilir, Supabase'deki satır güvenliği kurallarıyla belirlenir: ziyaretçiler menüyü ve yayındaki etkinlikleri okur; kişisel verileri yalnızca yöneticiler görür. Ayrıntılar `supabase/chezmoi.sql` dosyasında.
- Sitedeki Supabase anahtarı (`public/js/config.js`) herkese açık olacak şekilde tasarlanmış "publishable" anahtardır; gizli anahtar sitede ya da repoda yoktur.

## Yayın

`main` dalına her push'ta GitHub Actions (`.github/workflows/pages.yml`) siteyi derleyip GitHub Pages'e yükler. Ayrıca her gece bir kez yeniden derlenir. Adres: **https://kufuank.github.io/chez-moi-karakoy/**

Kendi alan adınızı (ör. chezmoikarakoy.com) bağlamak için: repo → Settings → Pages → Custom domain. Yayın iş akışı alt yolu kendisi ayarlar.

## Yönetim paneli

Adres: `/admin/`. Giriş, Supabase hesabıyla (e-posta + şifre) yapılır; hesabın `chezmoi_admins` tablosunda olması gerekir.

- **Menü:** ürün ekleme, adı/açıklamayı/fiyatı/kategoriyi değiştirme, silme (7 saniye içinde "Geri al"), arama; kategori ekleme, yeniden adlandırma, sıralama ve boş kategoriyi silme.
- **Etkinlikler:** kulüp geceleri. Ad, tarih, saat, kat, tür, sanatçılar, açıklama, afiş. **Bilet linki** girilirse sitede "Bilet al" çıkar; yoksa ve "ön kayıt al" işaretliyse **ön kayıt** formu açılır (isteğe bağlı kapasite). "Sitede yayınla" işaretsizse taslak kalır.
- **Rezervasyonlar:** gelen talepler; durum (Yeni / Onaylandı / İptal), arama linki, CSV, silme.
- **Ön kayıtlar:** etkinlik bazında liste; durum (Bekliyor / Onaylandı / Geldi / İptal), kişi / kapasite, CSV, silme.

**Yeni yönetici eklemek:** Supabase → Authentication → Users → **Add user** ile kişiyi ekleyin, sonra SQL Editor'de:

```sql
insert into public.chezmoi_admins (user_id) select id from auth.users where email = 'kisi@ornek.com';
```

## Yerelde çalıştırma

Node 20 veya üstü gerekir; başka bağımlılık yoktur.

```bash
npm run dev
```

Site http://localhost:3000 adresinde açılır (canlı Supabase verisiyle).

## Yapı

- `views/` — sayfa şablonları; `layout.html` ortak iskelet, `gate.html` giriş sayfası
- `build.mjs` — statik derleme; `serve.mjs` — yerel önizleme
- `public/js/config.js` — Supabase adresi ve herkese açık anahtar
- `public/js/render.js` — menü ve etkinliklerin HTML'i (derleme ve tarayıcı ortak kullanır)
- `public/js/live.js` — canlı veri ve formlar; `public/js/site.js` — gezinme ve hareket (GSAP + Lenis)
- `public/admin/` — panel; `backend.js` Supabase bağlantısı, `admin.js` menü, `admin-club.js` diğer sekmeler
- `public/img/` — fotoğraflar; `cut/` dekupe PNG'ler, `torn/` yırtık kâğıt baskılar, `ig/` Instagram görselleri
- `supabase/chezmoi.sql` — tablolar, kurallar, fonksiyonlar, afiş deposu
- `data/menu.json` — Supabase'e ulaşılamazsa derlemenin kullandığı menü yedeği
