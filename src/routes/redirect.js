const express = require('express');
const { nowSql } = require('../db');

function createRedirectRouter({ db }) {
  const router = express.Router();

  router.get('/:clickId', async (req, res, next) => {
    try {
    const rec = await db.getRecipientByClickId(req.params.clickId);
    if (!rec) return res.status(404).send('קישור לא נמצא');
    if (!rec.clicked_at) {
      await db.updateRecipient(rec.id, {
        clicked_at: nowSql(),
        status: rec.followup_sent_at ? 'clicked_after_followup' : 'clicked',
      });
    }
    const auto = await db.getAutomation(rec.automation_id);
    const target = auto?.second_dm_link_url;
    if (!target) return res.status(404).send('אין יעד לקישור');
    res.redirect(302, target);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRedirectRouter };
