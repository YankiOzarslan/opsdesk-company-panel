'use strict';
const multer = require('multer');
const crudRouter = require('./crud');
const rateLimit = require('express-rate-limit');
const { lookupProjectDomain } = require('../project-domain');
const { detectFromZip, DetectError } = require('../detect');

module.exports = function projectsRouter(ctx) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ctx.config.uploadMaxMb * 1024 * 1024, files: 1, fields: 5, parts: 6 },
    fileFilter(req, file, cb) {
      const ok = /\.zip$/i.test(file.originalname);
      cb(ok ? null : new DetectError('Yalnızca .zip dosyası yükleyebilirsiniz.'), ok);
    },
  });

  function detect(req, res) {
    upload.single('archive')(req, res, (err) => {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? `Dosya çok büyük (en fazla ${ctx.config.uploadMaxMb} MB).`
          : err instanceof DetectError ? err.message : 'Yükleme başarısız.';
        return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ ok: false, message });
      }
      if (!req.file) return res.status(400).json({ ok: false, message: 'Bir .zip dosyası seçin.' });
      try {
        const out = detectFromZip(req.file.buffer);
        if (!out.detected) {
          return res.json({ ok: true, detected: false, message: 'Teknoloji algılanamadı. Alanları elle doldurun.', ...out });
        }
        return res.json({ ok: true, ...out });
      } catch (e) {
        if (e instanceof DetectError) return res.status(400).json({ ok: false, message: e.message });
        throw e;
      }
    });
  }

  return crudRouter(ctx, ctx.entities.projects, {
    formView: 'projects/form',
    extend(router) {
      router.post('/detect', detect);
      router.post('/lookup-domain', rateLimit({windowMs:60000,limit:20,standardHeaders:'draft-7',legacyHeaders:false}), async (req,res,next) => {
        try { return res.json({ok:true,...await lookupProjectDomain(typeof req.body.query === 'string' ? req.body.query.slice(0,300) : '',ctx.db)}); }
        catch(error) { if(error.status) return res.status(error.status).json({ok:false,message:error.message}); return next(error); }
      });
    },
  });
};
