const fs=require('fs');
const {createRequire}=require('module');
const {spawnSync}=require('child_process');
const req=createRequire(process.cwd()+'/package.json');
req('ts-node/register/transpile-only');
const {PrismaClient}=req('@prisma/client');
const guard=req('./src/testing/test-db-guard');
req('./test/load-test-env').loadTestEnvFile();
const url=guard.requireTestDatabaseUrl();
const u=new URL(url);
if(u.hostname!=='localhost'||u.port!=='5433'||u.pathname!=='/zentuva_test'||u.username!=='zentuva_test')throw new Error('Unexpected endpoint');
const p=new PrismaClient({datasources:{db:{url}}});
async function main(){
 await guard.verifyConnectedToTestDatabase(p);
 const pre={organisations:await p.organisation.count(),conversations:await p.consumerConversation.count(),messageConfig:await p.d2CConversationMessageConfig.count(),capabilityConfig:await p.d2CConversationCapabilityConfig.count(),adjustmentJournals:await p.journalEntry.count({where:{sourceType:'INVENTORY_ADJUSTMENT'}})};
 console.log(JSON.stringify({preflight:pre}));
 if(pre.organisations!==1||pre.conversations||pre.messageConfig||pre.capabilityConfig||pre.adjustmentJournals)throw new Error('Existing unsafe cleanup could affect shared data: abort');
 await p.$disconnect();
 const prefix=process.argv[2];
 const fd=fs.openSync(prefix+'.log','wx');
 const start=new Date();
 const r=spawnSync('pnpm',['run','test:integration','--json','--outputFile='+prefix+'.json'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url,TEST_DATABASE_URL:url,NO_COLOR:'1'},stdio:['ignore',fd,fd]});
 fs.closeSync(fd);
 fs.writeFileSync(prefix+'-execution.json',JSON.stringify({start:start.toISOString(),end:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?.message,preflight:pre},null,2));
 console.log(JSON.stringify({exitCode:r.status,signal:r.signal,log:prefix+'.log',result:prefix+'.json'}));
 process.exitCode=r.status??1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());
