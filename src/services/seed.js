async function seedDemoAutomation(db, accountId) {
  const existing = await db.listAutomations(accountId);
  if (existing.length) return existing[0];
  return await db.createAutomation({
    account_id: accountId,
    name: 'מתכון — הכנה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: 'mock_media_reel_cake',
    media_permalink: 'https://www.instagram.com/reel/mock_cake/',
    media_thumbnail: 'https://placehold.co/800x1000/f8c8d8/4a1c2b?text=Reel',
    media_caption: 'הכנה של העוגה האהובה 🍰 שמרו לכם!',
    media_type: 'VIDEO',
    next_pending: 0,
    keyword_mode: 'keywords',
    keywords: 'הכנה, מתכון, אני רוצה',
    match_type: 'whole_word',
    public_reply_enabled: 1,
    public_reply_variants: JSON.stringify([
      'איזה כיף! שלחתי לך הודעה בפרטי ❤️',
      'שולחת לך עכשיו בפרטי 💌',
    ]),
    opening_dm_enabled: 1,
    opening_dm_text: 'היי! שמחה שאהבת 😊 רוצה שאשלח לך את ההכנה המלאה?',
    opening_dm_button_label: 'כן, אשמח ❤️',
    must_follow: 0,
    collect_email: 0,
    second_dm_text: 'הנה ההכנה המלאה מחכה לך כאן 👇',
    second_dm_link_url: 'https://example.com/recipe',
    second_dm_link_title: 'למתכון',
    followup_enabled: 1,
    followup_hours: 24,
    followup_text: 'היי, רק רציתי לוודא שקיבלת את הלינק 💕',
  });
}

module.exports = { seedDemoAutomation };
