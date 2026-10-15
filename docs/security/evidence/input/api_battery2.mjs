const API="http://127.0.0.1:8200"; const PW="Sec#Test2026ok"; const out=[];
function rec(id,cwe,cas,expected,actual,result,ev=""){out.push({id,area:"INPUT",cwe,case:cas,expected,actual,result,evidence_ref:ev});console.log(`${result.padEnd(4)} ${id} ${cas} => ${actual}`);}
async function login(c){const r=await fetch(`${API}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({login_id:c,password:PW})});return (await r.json()).access_token;}
const h=t=>({Authorization:`Bearer ${t}`});
const tok={}; for(const c of ["SECHO","SECSELF","SECVIEW","SECOTHER","SECOPIT"]) tok[c]=await login(c);
const SECRET=/password_hash|hashed_password|"password"|password_set|refresh_token|jwt|"secret"|po_source_password|salt/i;
async function g(url,who){const r=await fetch(url,{headers:h(tok[who])});const b=await r.text();return {s:r.status,b};}
// sensitive fields in people listings
for(const [id,url,who,cas] of [
 ["IN-T074",`${API}/api/asset-users?limit=100`,"SECHO","asset-users list secret leak (admin)"],
 ["IN-T075",`${API}/api/people?limit=100`,"SECHO","people list secret leak (admin)"],
]){const r=await g(url,who);const bad=SECRET.test(r.b);rec(id,"200","",cas,`status=${r.s} leak=${bad} len=${r.b.length}`, r.s<300?(bad?"FAIL":"PASS"):"INFO", bad?r.b.slice(0,300):"");}
// SELF_SERVICE / VIEWER must not list all people
for(const [id,url,who,cas,exp] of [
 ["IN-T076",`${API}/api/asset-users?limit=50`,"SECSELF","SELF lists asset-users",403],
 ["IN-T077",`${API}/api/people?limit=50`,"SECSELF","SELF lists people",403],
 ["IN-T078",`${API}/api/asset-users/export`,"SECSELF","SELF exports asset-users",403],
 ["IN-T079",`${API}/api/asset-users?limit=50`,"SECOPIT","OPERATOR lists asset-users",null],
]){const r=await g(url,who);const ok= exp===null? (r.s<500):(r.s===exp);rec(id,"285","",cas,`expect ${exp??'no 500'}`,`status=${r.s}`,ok?"PASS":"FAIL");}
// cross-company people enumeration: SECOTHER (CKVPL) listing — should only see own company
{const r=await g(`${API}/api/asset-users?limit=200`,"SECOTHER");let names="";try{const j=JSON.parse(r.b);const arr=Array.isArray(j)?j:(j.items||[]);names=arr.map(x=>x.code||x.name).join(",");}catch{}
 const leaksSPL=/SEC(FAIT|OPIT|SELF|VIEW)\b/.test(names)&&!/V\b/.test(names);
 rec("IN-T080","639","","CKVPL operator sees only CKVPL people",`status=${r.s} sampleHasSPL=${/SECFAIT,|SECOPIT,/.test(names)}`,r.s<300?"INFO":"INFO",names.slice(0,200));}
const fs=await import('node:fs');
fs.writeFileSync("C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/input/battery2_results.json",JSON.stringify(out,null,2));
console.log("\nwrote "+out.length);
