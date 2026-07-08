export type MedicalAutocompleteResult = { display: string; code: string };

export { searchRxNorm } from "./rxnorm";
export type { RxNormResult } from "./rxnorm";

export { searchConditions, searchLoincTests, searchProcedures } from "./clinical-tables";
export type { ConditionResult, LoincResult, CptResult } from "./clinical-tables";

export { searchSpecialties } from "./nucc";
export type { SpecialtyResult } from "./nucc";

export { searchVaccines } from "./vaccines";
export type { VaccineSearchResult } from "./vaccines";
