require("dotenv").config();
const express=require("express"),fs=require("fs"),path=require("path"),nodemailer=require("nodemailer"),twilio=require("twilio");
const app=express(),PORT=process.env.PORT||3000,DB=path.join(__dirname,"data.json");
app.use(express.json());app.use(express.static(path.join(__dirname,"public")));
function read(){try{return JSON.parse(fs.readFileSync(DB,"utf8"))}catch{return {dates:[],bookings:[]}}}
function write(d){fs.writeFileSync(DB,JSON.stringify(d,null,2))}
function auth(req){return req.headers["x-admin-code"]&&req.headers["x-admin-code"]===process.env.ADMIN_CODE}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&s>=new Date().toLocaleDateString("en-CA")}
async function email(to,subject,text){
 if(!to||!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS||!process.env.SMTP_FROM)return false;
 const t=nodemailer.createTransport({host:process.env.SMTP_HOST,port:+(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE)==="true",auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
 await t.sendMail({from:process.env.SMTP_FROM,to,subject,text});return true;
}
async function sms(to,body){
 if(!to||!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN||!process.env.TWILIO_PHONE_NUMBER)return false;
 const c=twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
 await c.messages.create({body,from:process.env.TWILIO_PHONE_NUMBER,to:to.startsWith("+")?to:"+"+to.replace(/\D/g,"")});return true;
}
app.get("/api/dates",(req,res)=>res.json({dates:read().dates}));
app.post("/api/admin/dates",(req,res)=>{
 if(!auth(req))return res.status(401).json({error:"Incorrect admin code."});
 const dates=Array.isArray(req.body.dates)?req.body.dates:[];
 if(dates.some(d=>!validDate(d)))return res.status(400).json({error:"Choose valid dates today or later."});
 const d=read();d.dates=[...new Set(dates)].sort();write(d);res.json({dates:d.dates});
});
app.post("/api/bookings",async(req,res)=>{
 const {name,email:customerEmail,phone,service,date}=req.body||{};
 if(!name||!customerEmail||!phone||!service||!date)return res.status(400).json({error:"Please complete every field."});
 const d=read();if(!d.dates.includes(date))return res.status(409).json({error:"That date is no longer available. Please choose another date."});
 d.dates=d.dates.filter(x=>x!==date);d.bookings.push({name,email:customerEmail,phone,service,date,createdAt:new Date().toISOString()});write(d);
 const dateText=new Date(date+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"});
 const customer=`Hello ${name}, your appointment for ${service} on ${dateText} has been booked.`;
 const business=`New appointment: ${name}; ${customerEmail}; ${phone}; ${service}; ${dateText}.`;
 const outcomes={};
 for(const [key,fn] of Object.entries({
  customerEmail:()=>email(customerEmail,"Appointment confirmation",customer),
  businessEmail:()=>email(process.env.BUSINESS_EMAIL,"New appointment booking",business),
  customerSms:()=>sms(phone,customer),
  businessSms:()=>sms(process.env.BUSINESS_PHONE,business)
 })){try{outcomes[key]=await fn()}catch(e){outcomes[key]=false;console.error(key,e.message)}}
 res.status(201).json({message:"Your appointment has been booked.",notifications:outcomes});
});
app.listen(PORT,()=>console.log(`Website running at http://localhost:${PORT}`));
