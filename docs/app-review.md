# Meta App Review plan — Rona DM Manager

**App:** Rona DM Manager  
**Meta App ID:** 1171722368541387  
**Login:** Facebook Login for Business (Unified Login), Instagram Graph API, Instagram professional account linked to a Facebook Page  
**Live URL (after deploy of this branch’s legal pages):** https://rona-dm-manager.onrender.com  
**Date researched:** 20 November 2026 (Asia/Jerusalem)  
**Sources:** [App Review for Instagram API](https://developers.facebook.com/documentation/instagram-platform/app-review), [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/), [Permissions Reference](https://developers.facebook.com/docs/permissions/), [Screen Recordings](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/), [Data Deletion Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback), [Retiring Access Verification (9 Oct 2026)](https://developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps/)

This document is ready to paste into App Review, plus a screencast script for each permission the code actually uses.

---

## Why Live / Advanced Access is required

In Development mode, Meta generally delivers comment and messaging webhooks only for people who have a role on the app. Rona’s automations must reply to ordinary Instagram followers who comment a keyword. That requires:

1. The app in **Live** mode.
2. **Advanced Access** for each permission used with those followers’ comments and conversations.
3. **Business Verification** (required for Advanced Access since 1 February 2023; still required in 2026).

If the app were used only by people who already have a role on it, Standard Access would be enough. That is not this case.

**Access Verification** for Tech Provider apps was **retired on 9 October 2026**. Do not wait on an Access Verification form. Business Verification and App Review still apply.

After Advanced Access is granted, complete **Data Use Checkup** when Meta asks (annual certification).

---

## Prerequisites (complete in App Dashboard before submitting)

| Item | What to enter | Status in this codebase |
| --- | --- | --- |
| **Privacy Policy URL** | `https://rona-dm-manager.onrender.com/privacy` | Added in branch `fix/audit-owner-handled` (`/privacy`). Goes live only after this branch is deployed. |
| **Terms of Service URL** | `https://rona-dm-manager.onrender.com/terms` | Added (`/terms`). Same deploy note. |
| **Data deletion instructions URL** | `https://rona-dm-manager.onrender.com/data-deletion` | Added (`/data-deletion`). |
| **Data Deletion Request callback** | Same URL: `https://rona-dm-manager.onrender.com/data-deletion` (POST, signed_request → JSON `{ url, confirmation_code }`) | Implemented in `src/routes/legal.js`. Meta accepts either an instructions URL or a callback; providing both is fine. |
| **App icon** | 1024×1024 px, no rounded corners baked in if Meta requests a square asset | Not generated here. Export from the existing PWA icons or a new 1024² mark. |
| **App category** | Suggested: **Business** (or Communication / Customer support if those are listed) | Set in App Dashboard → Settings → Basic. |
| **Business email** | The developer email in Developer Settings (where review results are sent) | Set in the dashboard. Use an inbox you monitor. |
| **Business Verification** | Connect the app to a verified Business Portfolio (Meta Business Manager). Upload the business documents Meta requests (legal name, address, phone, official docs). | Required. Start this first; it often takes longer than the review itself. |
| **Access Verification** | Not required as of 9 Oct 2026. | Skip. |
| **Successful API calls** | For some permissions, Meta requires at least one successful live API call before you can request Advanced Access. | From a role-user account, trigger login, list media, read comments, post a test public reply, and send one test DM (already done in development). Check App Dashboard → App Review → Permissions and Features if a permission is greyed out for lack of usage. |
| **External testability** | Reviewers must be able to open the live URL and log in. | Prepare a test Facebook user / Page / Instagram professional account and credentials, plus step-by-step login notes (see below). The Hebrew UI needs **English captions on the screencast**. |
| **Brand guidelines** | Login button or link must follow Meta’s Facebook Login for Business branding. | Confirm the in-app “connect Instagram” button before recording. |

Do not submit permissions the app does not use. The list below is taken from the default Facebook scopes in `src/config.js` and the actual Graph calls in `src/services/instagram.js`.

---

## Permissions the app actually uses

Default scopes:

`instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `instagram_manage_insights`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_messaging`, `business_management`

(`pages_messaging` is used in code even if it is sometimes omitted from informal lists: Page-linked sends go to `POST /{page-id}/messages`.)

When a permission is only a documented **dependency** of another, say so in the use-case text. If Meta still requires a separate request, submit it with the paste-ready text below.

---

### 1. `instagram_basic`

**Why needed:** Read the connected Instagram professional profile and its media so the owner can pick a post or reel and the app can bind an automation to that media (`GET /{ig-user-id}/media`, `GET /{media-id}`).

**Dependencies (as documented):** typically `pages_show_list` (and related Page permissions). Request those too.

**Use-case description (paste):**

```
Rona DM Manager is a comment-to-Direct-message automation tool for a professional Instagram account linked to a Facebook Page. After the account owner completes Facebook Login for Business and selects their Page and Instagram account, the app calls GET /{ig-user-id} and GET /{ig-user-id}/media (and GET /{media-id} when a specific post is opened) to show the owner’s username and their recent posts and reels. The owner uses this list only to choose which post or reel an automation should watch. We do not display or store other businesses’ Instagram media, and we do not use this data for advertising.
```

**Screencast script:**

1. Start logged out of the app and of Facebook.
2. Open https://rona-dm-manager.onrender.com (caption: “App home, logged out”).
3. Click the Facebook Login for Business button. Show the Meta window: the owner grants `instagram_basic` and selects the Facebook Page and the linked Instagram professional account.
4. Land back in the app. Caption: “Connected Instagram account, username loaded with instagram_basic.”
5. Open Automations → create or edit an automation → show the media picker listing the account’s posts/reels. Caption: “Media list from GET /{ig-user-id}/media.”
6. Select one reel. Caption: “Owner chooses the post the automation will watch.”

---

### 2. `instagram_manage_comments`

**Why needed:** Read comments on the selected media, detect keyword matches, and post a public reply on the comment (`GET /{media-id}/comments`, `GET /{comment-id}`, `POST /{comment-id}/replies`). Private replies that use `recipient.comment_id` also depend on comment access.

**Documented allowed usage:** read, update, and delete comments on Instagram professional accounts. This app **reads comments and creates public replies only**. It does not hide or delete comments. Say that clearly. (Meta’s permissions table sometimes shows a generic “publish a photo” screencast blurb for this permission; that is the wrong demo for this app. Show comment read + public reply.)

**Dependencies:** `instagram_basic`, `pages_read_engagement`, `pages_show_list`.

**Use-case description (paste):**

```
When a visitor comments a configured keyword (for example “הכנה”) on a post the account owner has attached to a live automation, Rona DM Manager reads that comment via the Instagram Comments API and posts a short public reply from the owner’s account (for example “שלחתי לך בפרטי ❤️”). The owner configures the reply text in the app. We use this permission only to read comments on the owner’s own media and to publish those public replies. We do not hide, delete, or moderate comments, and we do not comment on other accounts’ media.
```

**Screencast script:**

1. Repeat a short login + permission grant (or show the already-connected session and caption that this permission was granted at login).
2. Show a live automation on a specific post, keyword, and public-reply text.
3. From a second Instagram account (a tester), comment the keyword on that post. Show the comment on Instagram.
4. Show the app detecting the comment (בדיקה tab or a public reply appearing). Caption: “App reads comments with instagram_manage_comments.”
5. Show the public reply on the Instagram post, from the owner. Caption: “App posted a public reply with POST /{comment-id}/replies.”
6. Do not demo delete/hide.

---

### 3. `instagram_manage_messages`

**Why needed:** Send the opening Direct message (private reply) and any follow-up DMs; read conversation threads so the audit tab can see whether a commenter already received a message; receive message webhooks; optionally read `is_user_follow_business` when “must follow” is enabled.

**Documented allowed usage:** retrieve and manage Instagram Direct threads, including via a third-party tool.

**Dependencies:** `instagram_basic`, `pages_read_engagement`, `pages_show_list`.

**Use-case description (paste):**

```
After a keyword comment is matched, Rona DM Manager sends one opening Instagram Direct message to that commenter (a Private Reply tied to the comment, within Meta’s 7-day window). The message text is written by the account owner in the app (for example a welcome to a birth-preparation course and a request for name, pregnancy week, and area). If the owner enabled a button or a later follow-up, the app may send those additional messages in the same thread, still only in response to that commenter’s interaction. The app also reads Direct conversations so the owner can see who already received a message and to avoid sending twice. We do not scrape unrelated inboxes or message people who did not comment a keyword.
```

**Screencast script (Meta wants the message visible in the Instagram inbox client, not only a screenshot of an API response):**

1. Short login / grant of `instagram_manage_messages`.
2. Trigger the automation with a test comment (or use the already-running flow from the previous clip).
3. Show the app sending the opening DM (audit “send” or the automatic poller/webhook). Caption: “App sends a Private Reply / Direct message.”
4. On Instagram (web or mobile) open the tester’s inbox (or the owner’s sent message in Inbox) and show the delivered message on screen. Caption: “Message received in the Instagram inbox.”
5. Optionally open the app’s בדיקה / יומן tab and show the send logged, to demonstrate inbox read-back and dedupe.

---

### 4. `pages_show_list`

**Why needed:** After Facebook Login for Business, list Pages the user manages (`GET /me/accounts?fields=...,instagram_business_account`) so the app can attach the correct Page and the linked Instagram account.

**Use-case description (paste):**

```
Rona DM Manager uses Facebook Login for Business. After login we call GET /me/accounts to list the Pages the user manages and to read the Instagram professional account linked to the selected Page. This is how the owner chooses which Page/Instagram pair the automations should run on. We do not manage Pages the user did not select, and we do not use this list for ads.
```

**Screencast script:**

1. Logged out → Facebook Login for Business.
2. In the Meta dialog, show the Page picker (caption: “User grants pages_show_list and selects their Page”).
3. Back in the app, show the connected Page name / Instagram username on the Account screen. Caption: “App loaded the selected Page and linked Instagram account from GET /me/accounts.”

---

### 5. `pages_manage_metadata`

**Why needed:** Subscribe the Page to webhooks so comment and message events arrive while the app is live (`POST /{page-id}/subscribed_apps`). The app does not change other Page settings.

**Dependencies:** `pages_show_list`.

**Use-case description (paste):**

```
To receive Instagram comment and messaging events in near real time, Rona DM Manager subscribes the selected Facebook Page to webhooks with POST /{page-id}/subscribed_apps after the owner connects their account. This is the only Page setting the app changes. We do not edit the Page profile, hours, or other metadata.
```

**Screencast script:**

1. Login and Page selection (brief).
2. Show (or caption) that after connect, the app registers the Page for webhooks. If the UI has no dedicated “subscribe” button, annotate the Account/connect success and, if useful, a brief view of the App Dashboard webhook subscription or a server log line. Caption: “App calls POST /{page-id}/subscribed_apps so new comments can trigger automations.”
3. Post a test comment and show the automation firing without a manual refresh, to prove the subscription.

---

### 6. `pages_read_engagement`

**Why needed:** Documented dependency of `instagram_manage_comments` and `instagram_manage_messages`. The app does not build a Page insights dashboard. Request it as a dependency and say so.

**Dependencies:** `pages_show_list`.

**Use-case description (paste):**

```
We request pages_read_engagement only as a required dependency of instagram_manage_comments and instagram_manage_messages, which are the permissions Rona DM Manager uses to read comments on the owner’s Instagram media and to send Instagram Direct private replies. We do not use this permission to display Page engagement metrics, follower lists, or ad performance.
```

**Screencast script:**

1. Show the login grant that includes this permission (Meta dialog).
2. Caption: “Requested as a dependency of instagram_manage_comments and instagram_manage_messages.”
3. Continue into the comment-reply or DM clip so reviewers see the parent feature. Do not invent an insights screen.

---

### 7. `pages_messaging`

**Why needed:** When the Instagram account is Page-linked (the production path), outbound Direct/private replies and templates are sent with the Page access token to `POST /{page-id}/messages`.

**Dependencies:** `pages_manage_metadata`, `pages_show_list`.

**Use-case description (paste):**

```
When the owner’s Instagram professional account is linked to a Facebook Page, Rona DM Manager sends Instagram Direct private replies and any follow-up messages by calling POST /{page-id}/messages with the Page access token. This happens only after a visitor comments a keyword on the owner’s post, and only with the message text the owner configured. We do not use this permission for Messenger broadcast, ads, or cold outreach.
```

**Screencast script:**

1. Login grant including `pages_messaging`.
2. Trigger a keyword comment.
3. Show the app sending the message.
4. Show the message arriving in the Instagram inbox client (same standard Meta asks for messaging permissions: record the send and the inbox, not only a cURL result).
5. Caption: “Sent via POST /{page-id}/messages with the Page token.”

---

### 8. `business_management`

**Why needed:** Facebook Login for Business / Business Manager asset access. The app may read `client_business_id` on `/me` and, if needed, `GET /me/assigned_instagram_accounts` when Page listing is not enough. We do not create ad accounts or manage a Business Manager UI.

**Use-case description (paste):**

```
We request business_management as part of Facebook Login for Business so the owner can grant Rona DM Manager access to the Business Portfolio assets they already manage (their Facebook Page and the linked Instagram professional account). If GET /me/accounts is not sufficient, the app may also read assigned Instagram accounts for that business. The main permissions this supports are pages_show_list, instagram_basic, instagram_manage_comments, and instagram_manage_messages. We do not use business_management to create or claim ad accounts or to manage other businesses’ assets.
```

**Screencast script:**

1. Facebook Login for Business from logged out, including Business Portfolio / asset choice. Caption: “Owner grants business_management and selects business assets.”
2. Show the app connected to the correct Page + Instagram account. Caption: “App uses the granted business assets only to connect the owner’s Page and Instagram account.”
3. Do not demo ads.

---

## Suggested screencast package (practical)

Record in 1080p, window width ≤ 1440, large cursor, **no audio** (reviewers do not listen). The app UI is Hebrew — add **English captions / tooltips** on every important click.

One continuous “master” video plus short per-permission clips is easiest:

1. **Login master (2–4 min):** logged out → Facebook Login for Business → grant permissions → select Business, Page, Instagram → land in the app Account screen.
2. **Media + automation (1–2 min):** create or show a live automation, media picker, keyword, public reply text, opening DM text (no second button if you are not seeking extra messaging features).
3. **Comment + public reply (1–2 min):** tester comments the keyword → public reply appears on the post.
4. **DM inbox (1–2 min):** opening DM appears in the Instagram inbox client.
5. **Dedupe / audit (optional, 1 min):** בדיקה tab shows the commenter already has a public reply and a DM, so they are not messaged twice.

Reuse the login and send clips when a permission’s form asks for its own file.

---

## Verification notes for reviewers (paste into “how to log in and test”)

```
Platform: Web (https://rona-dm-manager.onrender.com).
Language: The app UI is Hebrew. Please follow the English captions in the screencasts.

1. Open the URL above.
2. Click the Facebook Login for Business button.
3. Sign in with the test user we provided and grant the requested permissions. Select the test Facebook Page and its linked Instagram professional account.
4. In Automations, open the live automation attached to the test reel/post. Keywords and reply text are already configured.
5. From the second Instagram test account, comment the keyword on that post.
6. Within about one minute (webhook or the one-minute comment poller), the owner account should post a public reply on the comment and send a Direct message. Confirm the message in the Instagram inbox.
7. The Audit (בדיקה) tab lists the commenter and whether a public reply and DM were sent. The journal (יומן) lists outbound sends.

Test credentials: [ADD Facebook test user email/password, Page name, Instagram usernames for owner and commenter.]
```

---



### 9. `instagram_manage_insights`

**Why needed:** Show the account owner (a midwife running a professional Instagram account) a “Data” tab with account trends (reach, views, follower growth, engagement rate), post/reel performance, and enrichment of public collaboration-partner profiles via `business_discovery`. Without this permission the app still works: it computes a limited fallback from media fields (`like_count`, `comments_count`, `timestamp`, `media_type`) and tells the owner that full insights will appear after Meta approval.

**Use-case description (paste):**

```
Rona DM Manager is a comment-to-DM automation tool for a professional Instagram account linked to a Facebook Page. In the in-app Data tab, the account owner reviews her own account performance so she can grow her birth-preparation course business: reach, views, follower growth, and engagement versus the previous 7- or 30-day period; which posts and reels work best; and best days and hours to publish. The app calls GET /{ig-user-id}/insights and GET /{media-id}/insights for these metrics, and may call business_discovery on Instagram usernames the owner saved in her private collaboration list (to show public follower count, media count, bio, and website). We request only the owner’s own insights (and public professional account fields she chose to look up). We do not use this data for advertising, and we do not access insights of people who comment or message the account.
```

**Screencast script:**

1. Start logged out. Open the live app URL (caption: “App home, logged out”).
2. Click Facebook Login for Business. Caption: “Owner grants instagram_manage_insights along with the existing Instagram and Page permissions, then selects the Page and linked Instagram professional account.”
3. Land in the app. Open the Data tab (נתונים). Caption: “Data tab loads account insights from GET /{ig-user-id}/insights.”
4. Show the 7 / 30 day toggle and the trend tiles (reach, views, followers, engagement) plus “what works” (top posts/reels, content type, best days/hours). Caption: “Metrics come from account and media insights of the connected professional account only.”
5. Scroll to a collaboration partner with an Instagram handle and tap refresh/enrich if shown, or open a partner profile section that displays followers and bio. Caption: “Optional business_discovery on a handle the owner saved; public fields only.”
6. If Advanced Access is not yet granted, also show the fallback note that full stats arrive after approval, and the media-field-based numbers still on screen.


## After this branch is deployed

1. Confirm `/privacy`, `/terms`, and `/data-deletion` load over HTTPS.
2. Paste those URLs into App Dashboard → Settings → Basic (Privacy Policy, Terms, Data Deletion).
3. For the callback, use `https://rona-dm-manager.onrender.com/data-deletion` (POST). Test once from Facebook: Settings → Apps and websites → remove app → Send Request.
4. Finish Business Verification if it is not already “verified.”
5. Switch individual permissions to **Request Advanced Access** and attach the use-case text + screencasts.
6. Do not flip the app to Live until Advanced Access is approved (or Meta will still block non-role users). After approval, set the app to Live and re-test a keyword comment from a normal Instagram account.

---

## Short Hebrew summary (ready to send)

כדי שהאוטומציה תעבוד מול עוקבות רגילות, ולא רק מול מי שיש לו תפקיד באפליקציה, צריך להעביר את האפליקציה ל-Live ולבקש Advanced Access על ההרשאות שהקוד באמת משתמש בהן. כל אפליקציה חדשה נפתחת במצב פיתוח; אי אפשר לדלג על זה.

חובה לפני ההגשה: אימות עסק (Business Verification) ב-Meta Business Manager — זה עדיין נדרש ב-2026 ל-Advanced Access, ולעיתים לוקח יותר זמן מהבדיקה עצמה. Access Verification ל-Tech Providers הופסק ב-9 באוקטובר 2026, אין צורך להגיש אותו. אחרי האישור תידרש גם Data Use Checkup שנתית.

בסניף הקוד נוסף עמודי מדיניות שצריך לפרוס ואז להדביק בלוח של Meta:

- מדיניות פרטיות: https://rona-dm-manager.onrender.com/privacy
- תנאי שימוש: https://rona-dm-manager.onrender.com/terms
- הוראות מחיקת נתונים: https://rona-dm-manager.onrender.com/data-deletion
- אותו כתובת משמשת גם כ-callback (POST) לבקשת מחיקה מפייסבוק.

עוד חסר בלוח האפליקציה: אייקון 1024×1024, קטגוריה (מומלץ Business), ואימייל עסקי לקבלת תוצאות הבדיקה. לכל הרשאה Meta דורשת לפעמים לפחות קריאת API אחת מוצלחת.

ההרשאות להגיש, עם הסבר קצר:

- instagram_basic — רשימת פוסטים/רילס כדי לבחור על מה רצה האוטומציה.
- instagram_manage_comments — קריאת תגובות ומענה ציבורי בפוסט.
- instagram_manage_messages — שליחת DM / Private Reply וקריאת השיחה כדי לא לשלוח פעמיים.
- pages_show_list — בחירת העמוד והחשבון המקושר אחרי ההתחברות.
- pages_manage_metadata — הרשמת העמוד ל-Webhooks בלבד.
- pages_read_engagement — תלות מתועדת של הרשאות האינסטגרם, בלי מסך סטטיסטיקות.
- pages_messaging — שליחת ההודעות דרך טוקן העמוד (הקוד כן משתמש בזה).
- business_management — גישה לנכסים בתיק העסק בזמן Facebook Login for Business, לא לניהול מודעות.
- instagram_manage_insights — טאב «נתונים»: חשיפה, צפיות, צמיחת עוקבות ומעורבות, ומה עובד בתוכן. בלי ההרשאה האפליקציה מחשבת מה שאפשר מהפוסטים ומציגה הערה עדינה.

לכל הרשאה צריך סרטון: התחברות מלאה ממצב מנותק, אישור ההרשאה, ואז שימוש אמיתי. ב-DM חייבים להראות את ההודעה מגיעה בתיבת אינסטגרם, לא רק בלוג. הממשק בעברית — חובה לשים כתוביות באנגלית. בלי קול.

אחרי שהעמודים עולים לאוויר, משלימים אימות עסק, מעלים את הסרטונים והטקסטים באנגלית (מוכנים להדבקה במסמך המלא), ומחכים לאישור לפני מעבר ל-Live.
