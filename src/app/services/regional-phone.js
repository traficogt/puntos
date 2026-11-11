import {normalizePhone} from '../../utils/phone.js';
import {badRequest} from '../../utils/http-error.js';
import {businessRegion} from './regional-settings.js';
/** Browser enrollment has a verified business context; other countries need
 * an explicit international prefix so a national number is never re-labelled. */
export function normalizeEnrollmentPhone(input,business){
 const value=String(input??'').trim(),country=businessRegion(business).country;
 if(!/^\+?[\d\s()-]{1,30}$/.test(value))throw badRequest('Ingresa un teléfono válido.');
 if(country!=='GT'&&!/^\+[1-9]/.test(value))throw badRequest('Incluye + y el código internacional del teléfono.');
 const phone=normalizePhone(value,country);
 if(!/^[1-9]\d{7,14}$/.test(phone))throw badRequest('Ingresa un teléfono válido con su código internacional.');
 return phone;
}
