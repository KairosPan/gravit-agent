// face/client/js/reducers/analog.js — the event analog slice (host/analog.js): each task read by its id and each event view by
// its id — loading, loaded, or failed with its words. A view the face no longer keeps (a 404) is failed and `gone`: forgetting
// the failed keeps it, so it is never asked again.
import { said, isLine } from '../i18n/words.js';

const slice = s => s.analog ?? { tasks: {}, views: {} };
const put = (s, part, id, entry) => (typeof id === 'string' ? { ...s, analog: { ...slice(s), [part]: { ...slice(s)[part], [id]: entry } } } : s);
const kept = entries => Object.fromEntries(Object.entries(entries).filter(([, v]) => v?.status !== 'failed' || v.gone === true));

export const reducers = {
  analogTaskLoading: (s, id) => put(s, 'tasks', id, { status: 'loading' }),
  analogTaskLoaded: (s, { id, task }) => put(s, 'tasks', id, { status: 'loaded', task }),
  analogTaskFailed: (s, { id, error }) => put(s, 'tasks', id, { status: 'failed', error: isLine(error) ? error : said('analog.task.failed') }),
  analogViewLoading: (s, id) => put(s, 'views', id, { status: 'loading' }),
  analogViewLoaded: (s, { id, view }) => put(s, 'views', id, { status: 'loaded', view }),
  analogViewFailed: (s, { id, error, gone }) => put(s, 'views', id, { status: 'failed', error: isLine(error) ? error : said('analog.view.failed'), gone: gone === true }),
  // every failed task and view forgotten, so the render reads it again — a gone view stays
  analogForgetFailed(s) {
    const { tasks, views } = slice(s);
    const keptTasks = kept(tasks);
    const keptViews = kept(views);
    return Object.keys(keptTasks).length === Object.keys(tasks).length && Object.keys(keptViews).length === Object.keys(views).length
      ? s : { ...s, analog: { ...slice(s), tasks: keptTasks, views: keptViews } };
  },
};
