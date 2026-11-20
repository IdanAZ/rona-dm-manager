# רונה · אוטומציות אינסטגרם

אפליקציה עצמאית (self-hosted) בסגנון ManyChat: מישהי מגיבה מילה שהגדרתם על פוסט או ריל — והמערכת עונה לה בתגובה ציבורית וגם שולחת הודעת פתיחה בפרטי (DM). אחרי שהיא לוחצת על כפתור («כן, אשמח ❤️») היא מקבלת את ההודעה השנייה, עם קישור במעקב.

הממשק בעברית, מותאם לטלפון (PWA שאפשר להוסיף למסך הבית), ומתאים לרונה ולעידן: כל אחד מתחבר עם «התחברות עם פייסבוק» (Facebook Login for Business / Unified Login) ומנהל רק את החשבונות שלו.

בלי פרטי Meta אפשר להריץ במצב הדגמה (`MOCK_MODE=true`), לבדוק את כל הזרימה, ורק אחר כך לחבר את החשבון האמיתי.

## מה כלול (שלב 1: אוטומציות)

לכל אוטומציה:

- **טריגר:** פוסט/ריל מסוים (נבחר מרשימת התכנים בחשבון), כל פוסט/ריל, או הפוסט/ריל **הבא** שיעלה.
- **תנאי לתגובה:** מילות מפתח מופרדות בפסיק (עברית נתמכת, בלי תלות ברישיות או ברווחים), התאמת מילה שלמה או «מכיל», או כל תגובה.
- **תגובה ציבורית** (אופציונלי) עם כמה גרסאות שנבחרות באקראי.
- **הודעת פתיחה ב-DM** כתשובה פרטית לתגובה (`recipient.comment_id`, Instagram Messaging / Private Replies). כפתור מענה מהיר.
- **בדיקת «חייבת לעקוב קודם»** (אופציונלי). במצב `api` נקרא `is_user_follow_business` ב-User Profile API (עם Page token). Meta דורשת הסכמה של המשתמשת, שבדרך כלל ניתנת רק אחרי שהיא כבר שלחה הודעה — לכן אחרי תגובה בלבד הבדיקה עלולה להיכשל, ואז לא חוסמים. במצב `stub` לא בודקים.
- **איסוף אימייל** (אופציונלי, מגושר): לאינסטגרם אין כפתור אימייל כמו ב-Messenger, לכן נשלחת בקשה בטקסט והמערכת מזהה כתובת בתשובה הבאה.
- **הודעה שנייה** אחרי הלחיצה על הכפתור, עם כפתור קישור אופציונלי.
- **תזכורת** אם לא לחצו על הקישור אחרי N שעות (מעקב קליקים דרך `/r/:id`). נשלחת רק בתוך חלון 24 השעות שאחרי האינטראקציה של המשתמשת.
- סטטוס פעילה/מושהית, ומדדים: כמה נשלחו, כמה הקליקו, ורשימת נמענות.

- **טאב «בדיקה»** (לקריאה בלבד): סורק תגובות עם מילת מפתח בפוסט נבחר, ובודק מי כבר קיבל DM מרונה (גם הודעה ידנית עם תוכן דומה). לא שולח הודעות. אפשר גם לקרוא `GET /api/audit/keyword-comments` עם סשן מחובר (`keyword`, `caption_prefix` או `media_id`).

כללים שנשמרים מול ה-API של Meta:

- תשובה פרטית אחת לכל תגובה, בתוך 7 ימים מהתגובה.
- הודעות המשך (הודעה שנייה ותזכורת) רק אחרי שהמשתמשת הגיבה (למשל לחצה על הכפתור), ובתוך 24 שעות.
- תגובות כפולות לא מעובדות פעמיים.
- ב-Facebook Login: אסימון המשתמש מוחלף לאסימון ארוך-טווח (~60 יום), וממנו מופק **אסימון עמוד (Page) שאינו פג תוקף**. ב-Instagram Login (אופציונלי) האסימון מתחדש כל 60 יום.

## הרצה מקומית (מצב הדגמה)

דרישות: Node.js 22 ומעלה.

```bash
cd rona-dm-manager
cp .env.example .env    # כבר מוגדר MOCK_MODE=true
npm install
npm start
```

פתחו בדפדפן: [http://localhost:3000](http://localhost:3000)

לחצו **«כניסה במצב הדגמה»**. תיווצר אוטומציה לדוגמה («מתכון — הכנה»). בטאב **סימולציה** אפשר לשלוח תגובה מזויפת ולראות בלוג מה היה נשלח (תגובה בפוסט, DM, כפתור, קישור).

בדיקות:

```bash
npm test          # בדיקות יחידה לזרימה
npm run test:flow # שרת HTTP במצב הדגמה + כל המסלול מקצה לקצה
```

פיתוח עם רענון אוטומטי: `npm run dev`.

## מעבר לחשבון האמיתי של רונה

אינסטגרם מאפשרת אוטומציה כזו **רק דרך ה-API הרשמי**. החשבון חייב להיות מקצועי (Creator או Business) — אצל רונה הוא כבר Creator, ומקושר לעמוד פייסבוק (למשל `rona_menahimov`) תחת תיק עסק.

באפליקציות Meta חדשות לרוב **אין** יותר את המסך «API setup with Instagram login». במקום זה מופיע **API setup with Unified login** — זה Facebook Login for Business עם `config_id`, והקריאות יוצאות אל `graph.facebook.com`. זה ברירת המחדל של האפליקציה (`AUTH_MODE=facebook`).

נתיב Instagram Login (`AUTH_MODE=instagram`, `graph.instagram.com`) נשאר בקוד כאופציה, אם Meta תאפשר אותו בעתיד לאפליקציה.

שלב ראשון אפשר לעבוד במצב Development של Meta, **רק עם אנשים וחשבונות שמוגדרים כבודקים (testers / roles)**. זה מתאים לרונה ולעידן, בלי App Review.

### 1. האפליקציה ב-Meta for Developers

אם האפליקציה כבר קיימת (למשל «Rona DM Manager»):

1. ודאו שהיא מחוברת לתיק העסק (Business portfolio) שמחזיק את העמוד ואת חשבון האינסטגרם של רונה.
2. Use cases → **Manage messaging & content on Instagram** → Customize → **API setup with Unified login**.

אם צריך ליצור אפליקציה חדשה: [developers.facebook.com](https://developers.facebook.com/) → My Apps → Create App (סוג Business / use case של ניהול הודעות ותוכן באינסטגרם), בבעלות תיק העסק.

העתיקו את **App ID** ואת ה-**App Secret** לקובץ `.env` (לא את «Instagram App ID» הישן):

```env
MOCK_MODE=false
AUTH_MODE=facebook
META_APP_ID=...
META_APP_SECRET=...
META_CONFIG_ID=...
WEBHOOK_VERIFY_TOKEN=בחרו-מחרוזת-סודית
APP_URL=https://YOUR-PUBLIC-URL
SESSION_SECRET=מחרוזת-ארוכה-ואקראית
```

### 2. יצירת תצורה (configuration / config_id)

במסך Unified login, בשלב **Configure your app**:

1. **Create new configuration** (או בחרו תצורה קיימת עם התווית Instagram Login Compatible).
2. תחת Edit permissions / assets, כללו לפחות:
   - נכסים: חשבון אינסטגרם, ועמוד פייסבוק (Pages) אם מוצע
   - הרשאות: `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`
   - וגם לפי הצורך: `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_messaging`, `business_management`
3. **Use this configuration**.
4. תחת **Redirect URL** הזינו בדיוק (HTTPS, בלי סלאש בסוף הדומיין):

```
https://YOUR-PUBLIC-URL/auth/facebook/callback
```

5. Save, והעתיקו את ה-`config_id` אל `META_CONFIG_ID`.

`config_id` אינו סוד; הוא מזהה את רשימת ההרשאות והנכסים. ב-OAuth האפליקציה שולחת `config_id` **במקום** רשימת `scope`.

### 3. הרשאות שצריך לכלול בתצורה

| הרשאה | בשביל מה |
| --- | --- |
| `instagram_basic` | פרטי החשבון ורשימת פוסטים/רילס (`/{ig-user-id}/media`) |
| `instagram_manage_comments` | תגובות, מענה ציבורי, Private Replies |
| `instagram_manage_messages` | DM, webhooks של הודעות, User Profile / `is_user_follow_business` |
| `pages_show_list` | רשימת עמודים (`/me/accounts`) והחשבון המקושר |
| `pages_manage_metadata` | הרשמת העמוד ל-Webhooks (`/{page-id}/subscribed_apps`) |
| `pages_read_engagement` | קריאת מעורבות / פרופיל לפי התיעוד |
| `pages_messaging` | שליחה אל `/{page-id}/messages` |
| `business_management` | גישה לנכסים דרך תיק העסק, אם התפקיד ניתן דרך Business Manager |

### 4. Webhooks

במסך Unified login → **Configure webhooks** (או Webhooks → Instagram):

- **Callback URL:** `https://YOUR-PUBLIC-URL/webhook`
- **Verify token:** אותו ערך כמו `WEBHOOK_VERIFY_TOKEN`
- הרשמה לשדות של האובייקט `instagram`: `comments`, `messages`, `messaging_postbacks`  
  (מומלץ גם `live_comments` לשידורים חיים)

אחרי שרונה מתחברת, האפליקציה גם שולחת `POST /{page-id}/subscribed_apps` (שדה עמוד `feed`, כנדרש ב-API) כדי להפעיל התראות ברמת העמוד. שדות האינסטגרם עצמם מוגדרים בלוח ה-Meta, לא בפרמטר `subscribed_fields` של העמוד.

השרת חייב להיות דלוק בזמן האימות ובזמן אמת. החתימה `X-Hub-Signature-256` נבדקת אוטומטית.

### 5. הוספת רונה כבודקת במצב פיתוח

במצב Development רק מי שיש לו תפקיד באפליקציה יכול להתחבר, ו-Webhooks מגיעים בעיקר מחשבונות בדיקה.

1. **App Roles → Roles:** הוסיפו את חשבון ה-Facebook של רונה (או של עידן, אם הוא מנהל את העמוד) כ-Tester / Developer.
2. במסך Unified login, בשלב Generate access tokens / testers: הזמינו את **חשבון האינסטגרם של רונה** כ-Instagram Tester.
3. רונה מאשרת את ההזמנה באינסטגרם (באתר): Settings → Website permissions → Apps and websites → Tester Invites, או [manage_access](https://www.instagram.com/accounts/manage_access/).
4. שתפו איתה את כתובת האפליקציה (`APP_URL`).
5. בטלפון היא נכנסת, לוחצת **«התחברות עם פייסבוק»**, בוחרת פייסבוק או אינסטגרם בחלון של Meta, מאשרת את תיק העסק / העמוד / חשבון האינסטגרם, ואפשר להוסיף למסך הבית:
   - אייפון, Safari: שיתוף → «הוספה למסך הבית»
   - אנדרואיד, Chrome: התפריט → «הוסף למסך הבית»

אם גם עידן מתחבר, הוסיפו גם אותו כבודק. כל משתמש רואה רק את החשבונות שהוא חיבר. אפשר לחבר יותר מחשבון אחד («הוספת חשבון אינסטגרם נוסף»).

זרימת האסימונים אחרי ההתחברות: קוד → אסימון משתמש קצר → אסימון משתמש ארוך-טווח → `GET /me/accounts?fields=...,instagram_business_account` → שמירת **Page access token** (לא פג תוקף) + מזהה חשבון האינסטגרם. אם Meta מחזירה אסימון System User בלי עמוד, יש נסיון גיבוי דרך `/me/assigned_instagram_accounts`.

### 6. מעבר לאישור מלא (App Review) — רק כשצריך

כדי לחבר לקוחות שאין להם תפקיד באפליקציה צריך Advanced Access ו-App Review, והאפליקציה במצב Live. לפעילות של רונה בלבד, Development + testers מספיק.

## בסיס נתונים: SQLite או Postgres

- אם המשתנה `DATABASE_URL` מוגדר (מתחיל ב-`postgres://` או `postgresql://`) — האפליקציה מתחברת ל-Postgres (חבילת `pg`). זה המצב ב-Render.
- אחרת נשמר SQLite בנתיב `DB_PATH` (ברירת מחדל `./data/rona-insta.db`). מצב ההדגמה והבדיקות המקומיות ממשיכים להשתמש ב-SQLite.

**אל תשמרו SQLite על שירות Web חינמי ב-Render:** מערכת הקבצים שם זמנית ונמחקת ב-spin-down או ב-redeploy — כולל אסימונים ואוטומציות.

## פריסה לשרת שפועל תמיד

האפליקציה חייבת לרוץ 24/7 כדי לקלוט תגובות בזמן אמת. הגדירו `MOCK_MODE=false`, `AUTH_MODE=facebook`, ואת פרטי Meta. `PORT` מסופק בדרך כלל על ידי הפלטפורמה. אם `APP_URL` לא מוגדר, נעשה שימוש ב-`RENDER_EXTERNAL_URL`.

### Render (תוכנית חינמית + Blueprint)

בפרויקט יש `render.yaml` שמתאים ל-**Rona's workspace**: שירות Web בתוכנית Free (`npm ci` / `npm start`, בדיקת תקינות ב-`/health`) ומסד Postgres חינמי שמחובר ל-`DATABASE_URL`.

**מגבלות חשובות של התוכנית החינמית:**

- שירות ה-Web **נרדם** אחרי חוסר פעילות. בזמן שינה Webhooks מאינסטגרם **ייכשלו או יחמיצו תגובות** עד שהשירות מתעורר. לשימוש יומיומי של רונה עדיף לשדרג לתוכנית שרצה תמיד.
- **Postgres חינמי ב-Render פג תוקף 30 יום אחרי היצירה** (ואחרי זה יש תקופת חסד קצרה). לפני שפג התוקף צריך לייצא את הנתונים, ליצור מסד חדש, או לשדרג. בלי זה יימחקו ההתחברויות והאוטומציות.

**איך מפרסים מ-Blueprint:**

1. ב-Render Dashboard, ב-workspace של רונה: **New → Blueprint**.
2. מחברים את הריפו הציבורי `rona-dm-manager` (או מדביקים את כתובת ה-GitHub). Render עלול לבקש הרשאת GitHub אם עדיין לא חיברתם חשבון; לריפו ציבורי אפשר גם להדביק URL.
3. מאשרים את ה-Blueprint. בסנכרון **הראשון** Render ישאל על המשתנים עם `sync: false`:
   - `META_APP_SECRET` — חובה (App Secret מלוח המפתחים של Meta).
   - `META_CONFIG_ID` — מזהה התצורה של Facebook Login for Business.
   - `APP_URL` — אפשר **להשאיר ריק** בפריסה הראשונה. האפליקציה תשתמש ב-`RENDER_EXTERNAL_URL` (למשל `https://rona-dm-manager.onrender.com`). אחר כך אפשר לעדכן לדומיין קבוע.
4. אחרי הפריסה, פותחים **Dashboard → השירות `rona-dm-manager` → Environment**:
   - מעתיקים את `WEBHOOK_VERIFY_TOKEN` (Render יוצר אותו פעם אחת עם `generateValue`; הוא **לא** מתחדש בסנכרון Blueprint חוזר) ומדביקים ב-Meta → Webhooks → Verify token.
   - `SESSION_SECRET` גם נוצר אוטומטית באותו מקום; אין צורך להעתיק אותו ל-Meta.
5. ב-Meta מגדירים Redirect `https://APP_URL/auth/facebook/callback` ו-Webhook `https://APP_URL/webhook`, עם ה-verify token ש הועתק מה-Environment.

`META_APP_ID` כבר מוגדר ב-Blueprint (`1171722368541387`). אין סודות בקוד או בריפו.

### Railway

- **יתרונות:** הקמה מהירה, משתני סביבה נוחים, Volume ל-SQLite, בדרך כלל תמיד-דלוק בתוכנית בתשלום.
- **חסרונות:** עלות חודשית, צריך לזכור להצמיד Volume ולא לסמוך על מערכת הקבצים הזמנית.

### Fly.io

- **יתרונות:** מכונה קטנה שרצה תמיד, Volumes יציבים ל-SQLite, שליטה טובה, אזורים קרובים למשתמשים.
- **חסרונות:** קצת יותר עבודה ראשונית (`fly launch`, יצירת volume, סיסמאות).

### Cloudflare Quick Tunnel / ngrok — רק לשלב בדיקה מול Meta

לבדיקה מהמכונה המקומית (או מה־box) בלי חשבון Cloudflare:

```bash
cloudflared tunnel --url http://localhost:3000
```

המנהרה נותנת כתובת `https://….trycloudflare.com`. עדכנו את `APP_URL` לאותה כתובת, הפעילו מחדש את האפליקציה, והזינו ב-Meta את ה-Redirect וה-Webhook עם הכתובת הזו.

**שימו לב:** כתובת Quick Tunnel **משתנה בכל הפעלה מחדש** של `cloudflared`. אחרי ריסטארט צריך לעדכן `APP_URL` ואת הערכים בלוח ה-Meta. לא מתאים לשימוש יומיומי של רונה — לפרודקשן השתמשו בדומיין קבוע (Render / Railway / Fly, או מנהרת Cloudflare עם שם קבוע).

ngrok (`ngrok http 3000`) עובד באותו אופן.

## משתני סביבה

ראו `.env.example`. העיקריים:

| משתנה | תפקיד |
| --- | --- |
| `MOCK_MODE` | `true` להדגמה מקומית, `false` לחיבור אמיתי |
| `AUTH_MODE` | `facebook` (ברירת מחדל) או `instagram` |
| `APP_URL` | כתובת ציבורית, בלי סלאש בסוף |
| `SESSION_SECRET` | סוד לעוגיות התחברות |
| `DB_PATH` | נתיב לקובץ SQLite |
| `META_APP_ID` / `META_APP_SECRET` | מתוך לוח המפתחים |
| `META_CONFIG_ID` | מזהה התצורה של Facebook Login for Business |
| `WEBHOOK_VERIFY_TOKEN` | אותו ערך כמו ב-Meta |
| `GRAPH_API_VERSION` | ברירת מחדל `v23.0` |
| `FOLLOW_CHECK_MODE` | `stub` או `api` |
| `FACEBOOK_SCOPES` | גיבוי אם אין `config_id` (ההרשאות האמיתיות מגיעות מהתצורה) |
| `INSTAGRAM_SCOPES` | ל-`AUTH_MODE=instagram` בלבד |

## מבנה הפרויקט

```
src/
  index.js             הפעלת השרת, חידוש אסימונים, תזכורות, סריקת פוסטים חדשים
  app.js               Express
  db.js                SQLite או Postgres לפי DATABASE_URL
  routes/              OAuth (Facebook + Instagram), API, Webhooks, מעקב קליקים
  services/engine.js   התאמת תגובות, שליחה, חלון 24 שעות
  services/instagram.js Graph API (facebook.com / instagram.com) + מצב הדגמה
  public/              ממשק עברי (PWA)
scripts/test-mock-flow.js
render.yaml            Blueprint ל-Render (Web Free + Postgres Free)
```

## מה עידן צריך לספק כדי לעלות לאוויר

1. אפליקציית Meta (למשל Rona DM Manager) עם **API setup with Unified login**, בבעלות תיק העסק שמחזיק את העמוד ואת חשבון האינסטגרם של רונה.
2. `META_APP_ID`, `META_APP_SECRET`, ו-`META_CONFIG_ID` (אחרי יצירת התצורה וה-Redirect URL).
3. כתובת HTTPS ציבורית כ-`APP_URL` (ב-Render אפשר להשאיר ריק ולהסתמך על `RENDER_EXTERNAL_URL`; בבדיקה מקומית: Quick Tunnel). בפרודקשן עדיף שרת שרץ תמיד. הנתונים נשמרים ב-Postgres כש-`DATABASE_URL` מוגדר.
4. ב-Meta: Redirect `https://APP_URL/auth/facebook/callback`, Webhook `https://APP_URL/webhook`, שדות `comments`, `messages`, `messaging_postbacks`, ו-verify token (ב-Render מעתיקים מ-Environment אחרי הפריסה).
5. הוספת רונה (פייסבוק + אינסטגרם) כבודקת, ואישור ההזמנה אצלה.
6. שליחת הקישור לרונה, **התחברות עם פייסבוק**, והוספה למסך הבית.

אחרי זה יוצרים אוטומציה בממשק, מפעילים אותה, ומגיבים מחשבון בדיקה כדי לוודא שתגובה + DM באמת מגיעים.
