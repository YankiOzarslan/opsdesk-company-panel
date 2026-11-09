# OpsDesk — kısa kullanım rehberi

## İlk çalıştırma

README içindeki kurulum adımlarını tamamlayın. `.env.example` dosyasını `.env` olarak kopyalayıp kendi yönetici e-postanızı, parola özetinizi ve rastgele oturum anahtarlarınızı girin. `npm start` sonrasında `http://localhost:4000` adresini açın. Kurulum boş kayıtlarla başlar.

## 1. Şirketinizi tanıtın

**Şirket ayarları** ekranına kendi şirket adınızı ve çalışanların yardım isteyeceği e-postayı yazın. Bu kurulum tek şirket içindir; şirket adını değiştirmek ayrı bir veri alanı oluşturmaz.

## 2. Çalışan hesabı oluşturun

**Kullanıcılar → Yeni kullanıcı** bölümünde ad, e-posta, rol ve başlangıç parolası girin. Çalışanı projelere atayacaksanız ekip kaydını da oluşturun. Başlangıç parolasını güvenli bir kanaldan paylaşın. Kullanıcı ilk girişinde kişisel parolasını seçer; davet veya SMTP gerekmez.

Yönetici tüm projeleri yönetir. Çalışan atandığı projeleri düzenler; aynı iş rolündeki projeleri görüntüleyebilir. Bir iş rolü, erişim kasasındaki parolaları açma yetkisi vermez.

## 3. Domain ve sunucuyu ekleyin

**Domainler → Yeni domain ekle** ile site adresini yazın. **Bilgileri getir** kayıt, DNS ve sertifika kaynaklarını sorgular. Eksik veya doğrulanamayan bilgileri gerçek bilgiymiş gibi kabul etmeyin.

**Sunucular → Yeni sunucu ekle** ile altyapı kaydını ve sorumlusunu ekleyin. Bu adımlar gerçek DNS veya sunucu yapılandırmasını değiştirmez.

## 4. Projenizi oluşturun

**Projeler → Yeni proje ekle** bölümünde domaini, teknolojiyi, sunucuyu, müşteri ve ekip üyelerini ilişkilendirin. **Siteden algıla** yalnızca dışarıya yayımlanan teknoloji izlerini okur. Sonuçları inceleyip uygulayın ve kaydedin. Gizli sürümler boş kalır.

## 5. Günlük takip

- Üst çubuktan tüm kayıtlarda arayın.
- Listeleri teknoloji, sürüm, durum ve sorumlu kayıtlarla filtreleyin.
- **Benim projelerim** ile kişisel sorumlulukları görün.
- **Sistem durumu** ile eksik bağlantıları ve yapılandırmayı inceleyin.
- **Yedekler** üzerinden anlık veya manuel veritabanı yedeği alın.

Taslak bildirimi geçici kayıt durumudur; asıl değişiklik için **Kaydet** düğmesine basın. Veritabanı yedeğiyle birlikte şifreleme anahtarının da ayrı, güvenli bir yedeğini tutun.

## Geliştirirken paylaşım sınırı

Gerçek kayıt, ekran görüntüsü, `.env`, anahtar, yedek veya erişim bilgisi eklemeyin. `npm run check:share` ve `npm test` çalıştırın. Kod incelemesinde yalnızca değişen dosyaları değil, eklenen dosyaların tamamını kontrol edin.
