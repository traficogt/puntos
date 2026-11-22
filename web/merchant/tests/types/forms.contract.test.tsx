import { NumberInput, Select } from '../../src/inputs';
import { useMerchantResource } from '../../src/typed-api';
import type { ProgramForm, ProgramUpdate } from '../../src/types/api';

const form: ProgramForm = { program_type: 'SPEND', rate: '', round: 'ceil', percent_off: null, stamps_required: null, head_start: null, reward_label: null, stamp_unit: 'visit', cashback_percent: null, load_bonus_percent: null, version: 'version' };
// @ts-expect-error Unfinished form input is not a valid program mutation.
const mutation: ProgramUpdate = form;
void mutation;

<NumberInput value="" onChange={value => { const input: number | string = value; void input; }} />;
// @ts-expect-error Decimal merchant forms do not support bigint values.
<NumberInput value={10n} />;
<Select value="branch-id" onChange={value => { const id: string | null = value; void id; }} />;
// @ts-expect-error Merchant select IDs are strings, not numeric values.
<Select value={10} />;

export function CheckedRegion() {
  const resource = useMerchantResource('/api/admin/region');
  // @ts-expect-error A loading resource can contain null data.
  resource.data.region;
  if (!resource.data) return null;
  // @ts-expect-error A region resource has no rewards collection.
  resource.data.rewards;
  return <span>{resource.data.region.currency}</span>;
}
