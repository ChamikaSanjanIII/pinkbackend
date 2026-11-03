# PM2 Deployment Guide for Backend (VPS)

VPS එකක මේ Backend එක PM2 මඟින් 24/7 background එකේ run කරගන්නා ආකාරය පහත දැක්වේ.

---

## 1. Prerequisites (VPS එක තුළ අවශ්‍ය දෑ)
VPS එකේ Node.js සහ PM2 install කර නොමැති නම්:
```bash
# Node.js LTS install කිරීම (අවශ්‍ය නම් පමණි)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 globally install කිරීම
sudo npm install -g pm2
```

---

## 2. Environment Variables (.env) සැකසීම
Backend directory එක ඇතුළේ `.env` file එකක් සාදා ගන්න (හෝ update කරන්න):
```bash
cd /path/to/your/backend
nano .env
```

`.env` එක තුළ අගයන් නිවැරදිව ලබා දෙන්න:
```env
PORT=5001
MONGO_URI=mongodb://127.0.0.1:27017/pinkhorse_db
JWT_SECRET=your_super_secret_jwt_key
ADMIN_EMAIL=chamikasanjan03@gmail.com
ADMIN_PASSWORD=YourSecurePassword123@
```
> **සටහන:** VPS එකේ වෙනත් backend එකක් port `5000` භාවිතා කරයි නම්, මෙහි `PORT=5001` (හෝ වෙනත් free port එකක්) ලෙස තබන්න.

---

## 3. Dependencies Install කිරීම
```bash
npm install --production
```

---

## 4. PM2 හරහා Backend එක Start කිරීම

Backend directory එක තුළ සිට පහත command එක run කරන්න:

```bash
pm2 start server.js --name "pinkhorse-backend"
```

---

## 5. VPS Restart වූ පසු Backend එක Auto-Start වීමට (Crucial Step)

VPS එක reboot වුවහොත් backend එක ස්වයංක්‍රීයව නැවත run වීම සඳහා:

```bash
# 1. Startup script එක configure කිරීම
pm2 startup

# (ඉහත command එකෙන් output එකක් ලෙස දෙන sudo env PATH=... command එක copy කර run කරන්න)

# 2. දැනට run වන apps save කර තබා ගැනීම
pm2 save
```

---

## 6. PM2 ප්‍රයෝජනවත් Commands (Useful Commands)

| විස්තරය | Command |
|---|---|
| Run වන processes බලාගැනීම | `pm2 list` හෝ `pm2 status` |
| Real-time Logs බැලීම | `pm2 logs pinkhorse-backend` |
| Server එක Restart කිරීම | `pm2 restart pinkhorse-backend` |
| Server එක Stop කිරීම | `pm2 stop pinkhorse-backend` |
| CPU / RAM භාවිතය බැලීම (Dashboard) | `pm2 monit` |
| Process එක delete කිරීම | `pm2 delete pinkhorse-backend` |

---

## 7. Nginx Reverse Proxy (Optional / Recommended)
Backend එක domain එකකට හෝ SSL (HTTPS) සමඟ connect කිරීමට Nginx reverse proxy එකක් භාවිතා කළ හැක:
sudo nano /etc/nginx/sites-available/api1.clipgo.xyz
```nginx
server {
    listen 80;
    server_name api1.clipgo.xyz;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

