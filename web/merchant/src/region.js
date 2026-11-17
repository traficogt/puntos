let current={country:'GT',currency:'GTQ',timezone:'America/Guatemala',locale:'es-GT',minorUnits:2};
export const merchantRegion=()=>current;
export function setMerchantRegion(region){if(region?.currency&&region?.timezone)current={...current,...region};}
/** @param {string | number | Date} value @param {Intl.DateTimeFormatOptions} [options] */
export function regionalDate(value,options={dateStyle:'medium',timeStyle:'short'}){
 if(!value)return 'Sin fecha';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Fecha no disponible';
 return new Intl.DateTimeFormat(current.locale,{...options,timeZone:current.timezone}).format(date);
}
/** Calendar date (YYYY-MM-DD) in the business timezone; never the UTC date. @param {Date} [now] @param {string} [timeZone] */
export function regionalToday(now=new Date(),timeZone=current.timezone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
