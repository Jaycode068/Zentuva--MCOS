const fs=require('fs');
const crypto=require('crypto');
const {spawnSync}=require('child_process');
const {createRequire}=require('module');
const req=createRequire(process.cwd()+'/package.json');
const out='/Users/user/Zentuva--MCOS/docs/assessment-evidence/stage-c1/';
for(const [target,file] of []){
 const r=spawnSync(process.execPath,['/private/tmp/zentuva-c1-snapshot.cjs',target,out+file],{stdio:'inherit'});
 if(r.status!==0)process.exit(r.status||1);
}
req('ts-node/register/transpile-only');
const {PrismaClient}=req('@prisma/client');
const guard=req('./src/testing/test-db-guard');
req('./test/load-test-env').loadTestEnvFile();
const prisma=new PrismaClient({datasources:{db:{url:guard.requireTestDatabaseUrl()}}});
async function main(){
 await guard.verifyConnectedToTestDatabase(prisma);
 const run=JSON.parse(fs.readFileSync(out+'run-1-execution.json'));
 const baseline=JSON.parse(fs.readFileSync(out+'test-before.json'));
 const evidence=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const all=await tx.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM sales_orders t');
  const added=all.filter(r=>{const v=JSON.parse(r.row);const ts=Number(v.orderCode.split('-')[2]);return v.orderCode.startsWith('SO-TEST-')&&ts>=new Date(run.start).getTime()});
  const remaining=all.filter(r=>!added.includes(r)).map(r=>r.row).sort();
  const result={leakedOrders:added.map(r=>{const v=JSON.parse(r.row);return {id:v.id,orderCode:v.orderCode,createdAt:v.createdAt,organisationId:v.organisationId,status:v.status}}),baselineOrderCount:baseline.tables.sales_orders.count,remainingOrderCount:remaining.length,baselineOrderHash:baseline.tables.sales_orders.sha256,remainingOrderHash:crypto.createHash('sha256').update(remaining.join('\n')).digest('hex')};
  result.roleMemberships=await tx.$queryRawUnsafe('SELECT r.rolname AS member, g.rolname AS granted_role FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.roleid');
  result.adjustmentIndex=await tx.$queryRawUnsafe("SELECT indexname,indexdef FROM pg_indexes WHERE tablename='inventory_transactions' AND indexname LIKE '%idempotency%'");
  result.testItemCounts=await tx.salesOrderItem.groupBy({by:['salesOrderId'],where:{salesOrderId:{in:result.leakedOrders.map(r=>r.id)}},_count:true});
  return result;
 },{timeout:30000,isolationLevel:'RepeatableRead'});
 fs.writeFileSync(out+'repeatability-evidence.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
 const dev=JSON.parse(fs.readFileSync(out+'development-before.json'));
 try{guard.assertSafeTestIdentity({database:dev.identity[0].database,user:dev.identity[0].role,...dev.roles[0]});throw new Error('Guard wrongly accepted dev');}catch(e){if(e.name!=='UnsafeTestDatabaseError')throw e;fs.writeFileSync(out+'development-identity-rejection.txt',e.message+'\n');console.log('Actual development identity rejected by test guard');}
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
