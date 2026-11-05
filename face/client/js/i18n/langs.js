// The face's two languages (Settings › Language): each one's own name, drawn the same under both tables (as dsh draws them),
// the code kept in gravit-ui.prefs, and <html lang>. Content, not table words.
import { EN } from './en.js';
import { ZH } from './zh.js';

export const LANGS = Object.freeze([{ id: 'en', name: 'English', html: 'en' }, { id: 'zh', name: '中文', html: 'zh-CN' }]); // en-kept: a language's own name

// a saved or chosen value, as a language's code: anything but 'zh' is English
export const langOf = v => (v === 'zh' ? 'zh' : 'en');
export const tableOf = id => (langOf(id) === 'zh' ? ZH : EN);
export const htmlLangOf = id => (langOf(id) === 'zh' ? 'zh-CN' : 'en');
