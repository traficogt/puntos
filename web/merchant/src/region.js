let current={country:'GT',currency:'GTQ',timezone:'America/Guatemala',locale:'es-GT',minorUnits:2};
export const merchantRegion=()=>current;
export function setMerchantRegion(region){if(region?.currency&&region?.timezone)current={...current,...region};}
export function regionalDate(value,options={dateStyle:'medium',timeStyle:'short'}){
 if(!value)return 'Sin fecha';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Fecha no disponible';
 return new Intl.DateTimeFormat(current.locale,{...options,timeZone:current.timezone}).format(date);
}
