// The synthetic sealed 10-27 run's view model (plan 1's fixtures), for the client tests' composed answers: test data only —
// the client itself never imports the plugin.
import { buildView } from '../../../plugins/lunhui/lib/view.mjs';
import { syntheticSealedRun } from '../../lunhui-view-fixtures.ts';

export const VIEW_1027 = buildView(syntheticSealedRun());
