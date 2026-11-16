import type {Branch, Customer, TeamMember} from './owner-workspace';
const branchId='22222222-2222-4222-8222-222222222222';
const uuid=(value:number)=>`55555555-5555-4555-8555-${String(value).padStart(12,'0')}`;
interface DemoInput {name?:string;previous_name?:string|null;email?:string;phone?:string;role?:'CASHIER'|'MANAGER';branch_id?:string|null;active?:boolean;can_manage_gift_cards?:boolean;address?:string;code?:string}
export function createOwnerDemoApi() {
 const customers:Customer[]=Array.from({length:27},(_,index)=>({id:uuid(index+1),name:index===0?'Ana López':index===1?'Carlos Méndez':`Cliente de ejemplo ${index+1}`,phone:`5025555${String(index+1).padStart(4,'0')}`,created_at:'2026-11-01T12:00:00Z',last_visit_at:index%3===0?null:'2026-11-15T12:00:00Z',points:80-index*2,pending_points:0,lifetime_points:100+index}));
 const branches:Branch[]=[{id:branchId,name:'Zona 4 · demo',address:'Zona 4, Ciudad de Guatemala',code:'jacaranda-centro'}];
 const staff:TeamMember[]=[{id:uuid(100),name:'Dueña de ejemplo',email:'duena@example.invalid',role:'OWNER',active:true,branch_id:branchId,can_manage_gift_cards:true},{id:uuid(101),name:'Lucía Pérez',email:'lucia@example.invalid',role:'CASHIER',active:true,branch_id:branchId,can_manage_gift_cards:false}];
 let sequence=200;
 return (url:URL,options:RequestInit={}):unknown=>{
  const path=url.pathname,method=options.method||'GET';
  const input:DemoInput=typeof options.body==='string'?JSON.parse(options.body):{};
  if(path==='/api/admin/customers'&&method==='GET'){
   const query=(url.searchParams.get('q')||'').toLocaleLowerCase('es-GT'),page=Number(url.searchParams.get('page')||1),limit=Number(url.searchParams.get('limit')||25);
   const rows=customers.filter(customer=>`${customer.name} ${customer.phone}`.toLocaleLowerCase('es-GT').includes(query));
   return structuredClone({ok:true,customers:rows.slice((page-1)*limit,page*limit),total:rows.length,page,limit,total_pages:Math.max(1,Math.ceil(rows.length/limit))});
  }
  if(path.startsWith('/api/admin/customers/')){
   const customer=customers.find(row=>row.id===path.split('/').at(-1));if(!customer)throw Object.assign(new Error('No encontramos este cliente.'),{status:404});
   if(method==='PATCH'){if(input.previous_name!==customer.name)throw Object.assign(new Error('El nombre cambió en otra sesión. Vuelve a abrir el perfil antes de guardar.'),{status:409});if(!input.name?.trim())throw new Error('Escribe el nombre.');customer.name=input.name.trim();}
   return structuredClone({ok:true,customer});
  }
  if(path==='/api/admin/branches'){
   if(method==='POST'){if(branches.length>=3)throw Object.assign(new Error('Llegaste al límite de sucursales de tu plan.'),{status:403});const branch={id:uuid(++sequence),name:input.name||'',address:input.address||null,code:input.code||`jacaranda-${sequence}`};branches.push(branch);return structuredClone({ok:true,branch});}
   return structuredClone({ok:true,branches});
  }
  if(path==='/api/admin/staff'){
   if(method==='POST'){if(staff.some(row=>row.email.toLowerCase()===input.email?.toLowerCase()))throw Object.assign(new Error('Ese correo ya tiene una cuenta.'),{status:409});const member:TeamMember={id:uuid(++sequence),name:input.name||'',email:input.email||'',role:input.role||'CASHIER',branch_id:input.branch_id||branchId,phone:input.phone||null,active:true,can_manage_gift_cards:!!input.can_manage_gift_cards};staff.unshift(member);return structuredClone({ok:true,staff:member});}
   return structuredClone({ok:true,staff});
  }
  if(path.startsWith('/api/admin/staff/')&&method==='PATCH'){
   const member=staff.find(row=>row.id===path.split('/').at(-1));if(!member||member.role==='OWNER')throw Object.assign(new Error('Esta cuenta no se puede editar.'),{status:400});
   if(input.active!==undefined)member.active=input.active;if(input.role)member.role=input.role;if(input.branch_id!==undefined)member.branch_id=input.branch_id;if(input.can_manage_gift_cards!==undefined)member.can_manage_gift_cards=input.can_manage_gift_cards;
   return structuredClone({ok:true,staff:member});
  }
  if(path==='/api/staff/security/reauth'&&method==='POST')return {ok:true};
  return undefined;
 };
}
const ownerDemo=createOwnerDemoApi();
export function demoOwnerWorkspace(url:URL,options:RequestInit={}) {return ownerDemo(url,options);}
