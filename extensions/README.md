# Obsolete — no extension needed

This folder used to stage a CapSolver `.crx` for AdsPower. After research confirmed CapSolver
doesn't officially support TikTok's slide puzzle, the project pivoted to SadCaptcha's Python
library (`tiktok-captcha-solver`), which solves TikTok puzzles inline from Python without any
browser extension.

**You can delete this folder safely:** `rm -rf extensions/`

All that's needed now:

```
SADCAPTCHA_API_KEY=sk_...   # from https://sadcaptcha.com/dashboard
```

That's it. No extension install, no AdsPower extension ID, no per-profile setup.
