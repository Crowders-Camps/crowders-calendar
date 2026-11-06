// Meals: read what is being served from the Kitchen Prep Builder's live version (its public relay feed,
// the same one the guest menu uses) and add a one-line summary under each Breakfast/Lunch/Dinner.
// Nothing is copied into this calendar's data; if the feed can't be reached the calendar shows as before.
(function(){
  const SRC="https://kitchen-prep.nate-5ff.workers.dev/public";
  const DAYS=["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
  const OLD=/^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY) (BREAKFAST|LUNCH|DINNER)$/;
  const CODE={ridge:"RIDGE",springs:"SPRINGS",smcc:"SM"};
  const KEEP=new Set(["GF","BBQ","BLT","PB&J","PBJ","OJ","DF","USA"]);
  // Sides and condiments left out of the one-line summary (they still show on the prep sheet and guest menu).
  const MINOR=/\b(SAUCES?|SYRUP|KETCHUP|MAYO|MUSTARD|RANCH|DRESSING|FROSTING|BUTTER|CUPS?|PACKETS?|SALSA|RELISH|SOUR CREAM|LETTUCE|SLICED|SHREDDED|CONDIMENTS?)\b/;
  const nice=n=>String(n||"").replace(/^\([A-Z]+\)\s*/,"").trim().split(/(\s+|\/|-)/).map(w=>{const u=w.toUpperCase();if(KEEP.has(u))return u;if(!/[A-Za-z]/.test(w))return w;if(/^(AND|OR|OF|WITH|ON|IN)$/.test(u))return w.toLowerCase();return w.charAt(0)+w.slice(1).toLowerCase()}).join("").replace(/^./,c=>c.toUpperCase());
  const monday=s=>{const d=D(s);return key(add(d,-((d.getDay()+6)%7)))};
  function summarize(lines,cat){
    const name=l=>{const it=l.ref!=null?cat.get(l.ref):null;return(it&&it.name)||l.name||""};
    const all=lines.filter(l=>!l.gf).map(name).filter(Boolean);
    let main=all.filter(n=>!MINOR.test(n.toUpperCase()));if(!main.length)main=all;
    const first=uniq(main.map(nice)).slice(0,3),more=main.length-first.length;
    if(!first.length)return"";
    return"Menu: "+first.join(", ")+(more>0?" + "+more+" more":"")+(lines.some(l=>l.gf)?" · GF option":"");
  }
  async function load(){
    try{
      const r=await fetch(SRC+"?t="+Math.floor(Date.now()/60000),{cache:"no-store"});
      if(!r.ok)return;
      const st=((await r.json())||{}).state;if(!st||!st.menus)return;
      const wk=monday(st.week||key(new Date()));
      const norm=o=>{const n={};Object.keys(o||{}).forEach(k=>{const m=k.match(OLD);n[m?key(add(D(wk),DAYS.indexOf(m[1])))+" "+m[2]:k]=o[k]});return n};
      const menus=norm(st.menus),off=norm(st.off),serve=norm(st.serve);
      const cat=new Map((st.catalog||[]).map(it=>[it.id,it]));
      let changed=false;
      EVENTS.forEach(e=>{let hit=false;e.items.forEach(i=>{
        if(i.g!=="meal")return;
        const k=i.d+" "+String(i.n||"").trim().toUpperCase(),lines=menus[k]||[],sv=serve[k]||"BOTH";
        const camps=sv==="BOTH"?["RIDGE","SPRINGS"]:[sv];
        const m=lines.length&&!off[k]&&camps.includes(CODE[e.camp])?summarize(lines,cat):"";
        if((i.m||"")!==m){i.m=m||undefined;hit=true}
      });if(hit){changed=true;e.hay=low([e.title,e.sub,CAMPS[e.camp].name,CAMPS[e.camp].short,STATUS[e.status]].concat(e.groups.map(g=>g.name+" "+g.event)).join(" ")+" "+e.items.map(itemText).join(" "))}});
      if(changed){renderCal();renderList()}
    }catch(_){}
  }
  load();setInterval(()=>{if(!document.hidden)load()},300000);
})();
