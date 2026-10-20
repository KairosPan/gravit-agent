// gravit-ui/js/reducers/index.js
import { reducers as messages } from './messages.js';
import { reducers as discover } from './discover.js';
import { reducers as account } from './account.js';
import { reducers as controls } from './controls.js';
import { reducers as markets } from './markets.js';
import { reducers as host } from './host.js';

export const reducers = { ...messages, ...discover, ...account, ...controls, ...markets, ...host };
