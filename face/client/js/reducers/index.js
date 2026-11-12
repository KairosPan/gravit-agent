// gravit-ui/js/reducers/index.js
import { reducers as messages } from './messages.js';
import { reducers as discover } from './discover.js';
import { reducers as account } from './account.js';
import { reducers as controls } from './controls.js';
import { reducers as markets } from './markets.js';
import { reducers as host } from './host.js';
import { reducers as channels } from './channels.js';
import { reducers as traces } from './traces.js';
import { reducers as owner } from './owner.js';
import { reducers as trade } from './trade.js';
import { reducers as runSheet } from './run-sheet.js';
import { reducers as lunhui } from './lunhui.js';
import { reducers as desk } from './desk.js';
import { reducers as search } from './search.js';
import { reducers as jobs } from './jobs.js';
import { reducers as identity } from './identity.js';
import { reducers as tasks } from './tasks.js';
import { reducers as analog } from './analog.js';

export const reducers = { ...messages, ...discover, ...account, ...controls, ...markets, ...host, ...channels, ...traces, ...owner, ...trade, ...runSheet, ...lunhui, ...desk, ...search, ...jobs, ...identity, ...tasks, ...analog };
