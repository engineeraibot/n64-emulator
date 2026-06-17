// Full decode of the MK64 green-fan draw state.
process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'24',10);
let auditOn=false, done=false;
const C4=['COMBINED','TEXEL0','TEXEL1','PRIM','SHADE','ENV','1','NOISE','0..'];
const C5=['COMBINED','TEXEL0','TEXEL1','PRIM','SHADE','ENV','SCALE','COMB_A','TEX0_A','TEX1_A','PRIM_A','SHADE_A','ENV_A','LODFRAC','PRIMLOD','K5','0..'];
const A3=['COMBINED/LOD','TEXEL0','TEXEL1','PRIM','SHADE','ENV','1','0'];
function nm4(s){return C4[s>8?8:s]+'('+s+')';}
function nm5(s){return C5[s>15?16:s]+'('+s+')';}
function nm3(s){return A3[s&7]+'('+(s&7)+')';}
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  const rs=this.rspState;
  if(auditOn && !done && ((rs.combine&&rs.combine.hi)>>>0)===0xff99ff){
    done=true;
    const hi=rs.combine.hi, lo=rs.combine.lo>>>0;
    log('=== GREEN FAN DRAW STATE ===');
    log('combine.hi=0x'+hi.toString(16)+' lo=0x'+lo.toString(16));
    const ccA=(hi>>>20)&0xF, ccB=(lo>>>28)&0xF, ccC=(hi>>>15)&0x1F, ccD=(lo>>>15)&0x7;
    const caA=(hi>>>12)&0x7, caB=(lo>>>12)&0x7, caC=(hi>>>9)&0x7, caD=(lo>>>9)&0x7;
    log('CYCLE0 color: ('+nm4(ccA)+' - '+nm4(ccB)+') * '+nm5(ccC)+' + '+nm4(ccD));
    log('CYCLE0 alpha: ('+nm3(caA)+' - '+nm3(caB)+') * '+nm3(caC)+' + '+nm3(caD));
    const c2=((rs.otherModeHi>>>20)&0x3)===1;
    log('cycleType='+((rs.otherModeHi>>>20)&0x3)+' (0=1cyc,1=2cyc,2=copy,3=fill)');
    if(c2){
      const ccA1=(hi>>>5)&0xF, ccB1=(lo>>>24)&0xF, ccC1=hi&0x1F, ccD1=(lo>>>6)&0x7;
      const caA1=(lo>>>21)&0x7, caB1=(lo>>>3)&0x7, caC1=(lo>>>18)&0x7, caD1=lo&0x7;
      log('CYCLE1 color: ('+nm4(ccA1)+' - '+nm4(ccB1)+') * '+nm5(ccC1)+' + '+nm4(ccD1));
      log('CYCLE1 alpha: ('+nm3(caA1)+' - '+nm3(caB1)+') * '+nm3(caC1)+' + '+nm3(caD1));
    }
    log('otherModeHi=0x'+(rs.otherModeHi>>>0).toString(16)+' otherModeLo=0x'+(rs.otherModeLo>>>0).toString(16));
    // blender: otherModeLo bits 16..31 are the two blend cycles (P,A,M,B each 2 bits)
    const oml=rs.otherModeLo>>>0;
    const bl=(oml>>>16)&0xFFFF;
    const P0=(bl>>>14)&3,A0=(bl>>>10)&3,M0=(bl>>>6)&3,B0=(bl>>>2)&3; // rough split
    log('blendWord=0x'+bl.toString(16)+'  (P,A,M,B nibble pairs) raw c0='+((bl>>>8)&0xff).toString(16)+' c1='+(bl&0xff).toString(16));
    log('alphaCompare(bits0-1)='+(oml&3)+' zMode(bits10-11)='+((oml>>>10)&3)+' forceBlend(bit14)='+((oml>>>14)&1)+' cvgXalpha(bit13)='+((oml>>>13)&1)+' alphaCvgSel(bit12)='+((oml>>>12)&1));
    log('primColor=0x'+(rs.primColor>>>0).toString(16)+' envColor=0x'+(rs.envColor>>>0).toString(16));
    log('useTexture='+rs.useTexture+' combinerUsesTexture='+rs.combinerUsesTexture+' currentTile='+rs.currentTile);
    const t=rs.tiles[rs.currentTile|0]||{};
    log('tile: fmt='+t.format+' size='+t.size+' line='+t.line+' tmem='+t.tmem+' palette='+t.palette+
        ' cmS='+t.cmS+' cmT='+t.cmT+' maskS='+t.maskS+' maskT='+t.maskT+
        ' uls='+t.uls+' ult='+t.ult+' lrs='+t.lrs+' lrt='+t.lrt+' shiftS='+t.shiftS+' shiftT='+t.shiftT);
    log('textureScaleS='+rs.textureScaleS+' textureScaleT='+rs.textureScaleT);
    // vertices
    [v1,v2,v3].forEach((v,i)=>log('  v'+i+': screen('+(v.x|0)+','+(v.y|0)+') rgba('+(v.r|0)+','+(v.g|0)+','+(v.b|0)+','+(v.a|0)+') st('+(v.s||0).toFixed(1)+','+(v.t||0).toFixed(1)+') cw='+(v.cw||v.w||0).toFixed(1)));
    // dump I4 texture (size0): width from lrs/uls
    const w=t.lrs>t.uls?(((t.lrs-t.uls)>>2)+1):16;
    const h=t.lrt>t.ult?(((t.lrt-t.ult)>>2)+1):16;
    log('texture '+w+'x'+h+' (I4):');
    const ramp=' .:-=+*#%@';
    for(let y=0;y<Math.min(h,20);y++){
      let row='';
      for(let x=0;x<Math.min(w,48);x++){
        const p=(t.tmem*8 + y*t.line*8 + (x>>1));
        const b=this.tmem[p]||0;
        const v=(x&1)?(b&0xF):(b>>4);
        row+=ramp[(v*9/15)|0];
      }
      log('  |'+row+'|');
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('done?',done);
