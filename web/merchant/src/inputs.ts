import { NumberInput as MantineNumberInput, Select as MantineSelect } from '@mantine/core';

// Merchant forms use decimal numbers (including unfinished string input) and
// string IDs. Specialize Mantine's generics without wrapping either component.
export const NumberInput = MantineNumberInput<number>;
export const Select = MantineSelect<string>;
