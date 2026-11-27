# Стенд на Ubuntu 24.04 x86-64

Подготовьте VPS в Timeweb, доменное имя и проверенный коммит исходников. В DNS направьте запись A на публичный IPv4 сервера. Откройте 80 и 443 для HTTPS и выпуска сертификата, сохранив доступ по SSH. Next слушает только локальный адрес.

## Приложение и данные

На сервере выполните команды от пользователя с `sudo`. Укажите фактические SHA и путь к исходному XML. Репозиторий должен содержать проверенную версию приложения.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx certbot sqlite3 xz-utils
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin ai-forge

node_release=v24.15.0
node_archive="node-$node_release-linux-x64.tar.xz"
dist="https://nodejs.org/dist/$node_release"
cd "$(mktemp -d)"
curl -fsSLO "$dist/$node_archive"
curl -fsSLO "$dist/SHASUMS256.txt"
sha256sum --check --ignore-missing SHASUMS256.txt &&
  sudo tar -xJf "$node_archive" -C /opt
export PATH="/opt/node-v24.15.0-linux-x64/bin:$PATH"
node --version

release='<SHA проверенного коммита>'
catalog_xml='/absolute/path/to/Mindbox.yml.gz.xml'
sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/ai-forge-support
git clone https://github.com/warbr1ng3r/ai-forge-support.git /opt/ai-forge-support
cd /opt/ai-forge-support
git checkout --detach "$release"
npm ci
npm run catalog:import -- "$catalog_xml"
npm run catalog:check
NEXT_TELEMETRY_DISABLED=1 npm run build

sudo install -d -m 0750 -o root -g ai-forge /var/lib/ai-forge-support-catalog
sudo install -m 0640 -o root -g ai-forge data/t06/catalog.sqlite /var/lib/ai-forge-support-catalog/catalog.sqlite
sudo install -d -m 0700 /etc/ai-forge-support
sudo touch /etc/ai-forge-support/runtime.env
sudo chmod 0600 /etc/ai-forge-support/runtime.env
sudoedit /etc/ai-forge-support/runtime.env
```

В файле окружения задайте `POLZA_API_KEY` и `MANAGER_ACCESS_TOKEN`. Используйте отдельный ключ Polza с ограниченным бюджетом для стенда и случайный токен менеджера. Передайте доступ проверяющим отдельно от публичной ссылки.

```sh
sudo install -m 0644 deploy/ai-forge-support.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/ai-forge-support.service
sudo systemctl daemon-reload
sudo systemctl enable --now ai-forge-support
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:3013/ -o /dev/null
```

Служба автоматически поднимается после перезагрузки и перезапускается после аварийного завершения. SQLite хранит очередь, ответы и базу знаний в `/var/lib/ai-forge-support/support.sqlite`. Каталог открывается по отдельному пути с правами чтения для службы. Сохраняйте оба каталога при обновлении сборки. Для резервной копии работающей БД используйте SQLite `.backup`, который захватывает записи из WAL.

```sh
sudo install -d -m 0700 /var/backups/ai-forge-support
sudo sqlite3 /var/lib/ai-forge-support/support.sqlite \
  ".backup /var/backups/ai-forge-support/support-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

## Публичный HTTPS

Из каталога приложения задайте домен и email для Certbot. Первая конфигурация принимает только проверку домена для сертификата.

```sh
domain='support.example.com'
acme_email='admin@example.com'
sudo install -d -m 0755 /var/www/ai-forge-acme
sudo tee /etc/nginx/sites-available/ai-forge-support >/dev/null <<EOF
server {
    listen 80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root /var/www/ai-forge-acme; }
    location / { return 404; }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/ai-forge-support /etc/nginx/sites-enabled/ai-forge-support
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/ai-forge-acme --cert-name "$domain" -d "$domain" \
  --email "$acme_email" --agree-tos --non-interactive

sed "s/support\.example\.com/$domain/g" deploy/nginx.conf |
  sudo tee /etc/nginx/sites-available/ai-forge-support >/dev/null
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable nginx
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nexec systemctl reload nginx\n' |
  sudo tee /etc/letsencrypt/renewal-hooks/deploy/ai-forge-nginx >/dev/null
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/ai-forge-nginx
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
```

Nginx передаёт публичный hostname и схему HTTPS для проверки origin и cookie менеджера. Поток чата проходит без буферизации. Для платного маршрута заданы 30 запросов в минуту на IP и 90 по всему стенду, с краткими всплесками и пределом 4 и 12 одновременных ответов соответственно. При превышении клиент получает 429 с временем до повторной попытки. Вход менеджера ограничен 6 запросами в минуту на IP с краткими всплесками.

После развёртывания проверьте публичную страницу из внешней сети, поток одного тестового диалога, вход менеджера и доставку ответа клиенту. Убедитесь, что ответ остаётся доступен после `sudo systemctl restart ai-forge-support`. Логи службы доступны через `sudo journalctl -u ai-forge-support -n 80`.

[Node.js 24.15.0](https://nodejs.org/dist/v24.15.0/) · [Самостоятельное размещение Next.js](https://nextjs.org/docs/app/guides/self-hosting) · [Лимиты Nginx](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html) · [Certbot Webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).
