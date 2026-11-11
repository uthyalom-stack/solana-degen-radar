const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export class PerformanceService {
  static async recordActivity(db: D1Database, sessionId: string, activityType: string, referenceId?: string) {
    const date = now().slice(0, 10);
    await db.prepare(`INSERT OR IGNORE INTO performance_activity
      (id,session_id,activity_date,activity_type,reference_id,created_at) VALUES (?,?,?,?,?,?)`)
      .bind(uid(), sessionId, date, activityType.slice(0, 48), referenceId || null, now()).run();
    return { recorded: true, activityDate: date };
  }

  static async getPerformance(db: D1Database, sessionId: string) {
    const [activity, positions, risk, recent] = await Promise.all([
      db.prepare("SELECT activity_date FROM performance_activity WHERE session_id=? ORDER BY activity_date DESC LIMIT 400").bind(sessionId).all<any>(),
      db.prepare("SELECT id,mint,status,opened_at,closed_at,realized_pnl_usd,fees_usd FROM paper_positions WHERE session_id=? ORDER BY COALESCE(closed_at,opened_at) DESC LIMIT 500").bind(sessionId).all<any>(),
      db.prepare("SELECT * FROM portfolio_risk_settings WHERE session_id=?").bind(sessionId).first<any>(),
      db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN realized_pnl_usd>0 THEN 1 ELSE 0 END) wins, SUM(CASE WHEN realized_pnl_usd<0 THEN 1 ELSE 0 END) losses, SUM(realized_pnl_usd) pnl FROM paper_positions WHERE session_id=? AND status='closed'").bind(sessionId).first<any>(),
    ]);
    const dates = (activity.results || []).map((r:any)=>String(r.activity_date));
    const active = new Set(dates);
    let currentActivity = 0;
    const cursor = new Date();
    while (active.has(cursor.toISOString().slice(0,10))) { currentActivity++; cursor.setUTCDate(cursor.getUTCDate()-1); }
    // Do not erase a streak when the current day has not yet had activity; yesterday can still be active.
    if (!currentActivity) {
      const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate()-1);
      if (active.has(yesterday.toISOString().slice(0,10))) {
        cursor.setTime(yesterday.getTime());
        while (active.has(cursor.toISOString().slice(0,10))) { currentActivity++; cursor.setUTCDate(cursor.getUTCDate()-1); }
      }
    }
    let bestActivity = 0, run = 0, previous = "";
    for (const d of [...dates].sort()) {
      const day = new Date(d+"T00:00:00.000Z");
      if (previous) {
        const prev = new Date(previous+"T00:00:00.000Z");
        const gap = (day.getTime()-prev.getTime())/86400000;
        run = gap === 1 ? run+1 : 1;
      } else run = 1;
      bestActivity = Math.max(bestActivity,run); previous=d;
    }
    const completed = (positions.results || []).filter((p:any)=>p.status==="closed" && p.realized_pnl_usd!=null);
    const ordered = completed.sort((a:any,b:any)=>String(b.closed_at||"").localeCompare(String(a.closed_at||"")));
    const classify = (p:any) => Number(p.realized_pnl_usd)>0 ? "win" : Number(p.realized_pnl_usd)<0 ? "loss" : "flat";
    const currentKind = ordered.length ? classify(ordered[0]) : "none";
    let outcomeRun = 0;
    if (currentKind !== "none" && currentKind !== "flat") {
      for (const p of ordered) { if (classify(p) !== currentKind) break; outcomeRun++; }
    }
    let bestWin=0,bestLoss=0,winRun=0,lossRun=0;
    for (const p of [...completed].sort((a:any,b:any)=>String(a.closed_at||"").localeCompare(String(b.closed_at||"")))) {
      const k=classify(p);
      winRun=k==="win"?winRun+1:0; lossRun=k==="loss"?lossRun+1:0;
      bestWin=Math.max(bestWin,winRun); bestLoss=Math.max(bestLoss,lossRun);
    }
    return {
      activityStreak:{current:currentActivity,longest:bestActivity,activeDays:dates.length,activityDays:[...new Set(dates)].sort().reverse().slice(0,90)},
      tradeStreak:{currentType:currentKind,current:outcomeRun,longestWinning:bestWin,longestLosing:bestLoss},
      tradeStats:{total:Number(recent?.total)||0,wins:Number(recent?.wins)||0,losses:Number(recent?.losses)||0,realizedPnlUsd:Number(recent?.pnl)||0},
      riskSettings:risk || {session_id:sessionId,enabled:1,daily_loss_limit_usd:null,max_open_positions:null,max_position_size_usd:null,cooldown_minutes:0},
      recentPositions:ordered.slice(0,30).map((p:any)=>({...p,outcome:classify(p)}))
    };
  }

  static async saveJournal(db:D1Database, sessionId:string, input:any) {
    const title=String(input.title||"").trim();
    if(!title) throw new Error("Journal title is required");
    const id=String(input.id||uid());
    const existing=await db.prepare("SELECT id FROM trade_journal_entries WHERE id=? AND session_id=?").bind(id,sessionId).first();
    const stamp=now();
    if(existing) {
      await db.prepare(`UPDATE trade_journal_entries SET position_id=?,mint=?,title=?,thesis=?,entry_reason=?,exit_reason=?,lessons=?,tags_json=?,mood=?,updated_at=? WHERE id=? AND session_id=?`)
        .bind(input.positionId||null,input.mint||null,title,String(input.thesis||""),String(input.entryReason||""),String(input.exitReason||""),String(input.lessons||""),JSON.stringify(Array.isArray(input.tags)?input.tags.slice(0,20):[]),input.mood||null,stamp,id,sessionId).run();
    } else {
      await db.prepare(`INSERT INTO trade_journal_entries
        (id,session_id,position_id,mint,title,thesis,entry_reason,exit_reason,lessons,tags_json,mood,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,sessionId,input.positionId||null,input.mint||null,title,String(input.thesis||""),String(input.entryReason||""),String(input.exitReason||""),String(input.lessons||""),JSON.stringify(Array.isArray(input.tags)?input.tags.slice(0,20):[]),input.mood||null,stamp,stamp).run();
    }
    return {id,saved:true};
  }

  static async listJournal(db:D1Database, sessionId:string) {
    const rows=await db.prepare("SELECT * FROM trade_journal_entries WHERE session_id=? ORDER BY updated_at DESC LIMIT 200").bind(sessionId).all<any>();
    return rows.results||[];
  }

  static async getRiskSettings(db:D1Database, sessionId:string) {
    return await db.prepare("SELECT * FROM portfolio_risk_settings WHERE session_id=?").bind(sessionId).first<any>()
      || {session_id:sessionId,enabled:1,daily_loss_limit_usd:null,max_open_positions:null,max_position_size_usd:null,cooldown_minutes:0};
  }

  static async saveRiskSettings(db:D1Database, sessionId:string, input:any) {
    const daily=input.dailyLossLimitUsd==null||input.dailyLossLimitUsd===""?null:Number(input.dailyLossLimitUsd);
    const maxPositions=input.maxOpenPositions==null||input.maxOpenPositions===""?null:Math.max(1,Math.min(100,Math.floor(Number(input.maxOpenPositions))));
    const maxSize=input.maxPositionSizeUsd==null||input.maxPositionSizeUsd===""?null:Number(input.maxPositionSizeUsd);
    const cooldown=Math.max(0,Math.min(1440,Math.floor(Number(input.cooldownMinutes)||0)));
    if(daily!==null&&(!Number.isFinite(daily)||daily<=0)) throw new Error("Daily loss limit must be positive");
    if(maxSize!==null&&(!Number.isFinite(maxSize)||maxSize<=0)) throw new Error("Maximum position size must be positive");
    await db.prepare(`INSERT INTO portfolio_risk_settings(session_id,enabled,daily_loss_limit_usd,max_open_positions,max_position_size_usd,cooldown_minutes,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET enabled=excluded.enabled,daily_loss_limit_usd=excluded.daily_loss_limit_usd,max_open_positions=excluded.max_open_positions,max_position_size_usd=excluded.max_position_size_usd,cooldown_minutes=excluded.cooldown_minutes,updated_at=excluded.updated_at`)
      .bind(sessionId,input.enabled===false?0:1,daily,maxPositions,maxSize,cooldown,now()).run();
    return this.getRiskSettings(db,sessionId);
  }

  static async checkPaperBuyRisk(db:D1Database, sessionId:string, amountUsd:number) {
    const s=await this.getRiskSettings(db,sessionId);
    if(!s.enabled) return {allowed:true};
    const violations:string[]=[];
    if(s.max_position_size_usd!=null&&amountUsd>Number(s.max_position_size_usd)) violations.push("Position exceeds your configured maximum size");
    if(s.max_open_positions!=null) {
      const open=await db.prepare("SELECT COUNT(*) n FROM paper_positions WHERE session_id=? AND status='open'").bind(sessionId).first<any>();
      if(Number(open?.n||0)>=Number(s.max_open_positions)) violations.push("Maximum open positions reached");
    }
    if(s.daily_loss_limit_usd!=null) {
      const day=now().slice(0,10);
      const pnl=await db.prepare("SELECT COALESCE(SUM(realized_pnl_usd),0) pnl FROM paper_positions WHERE session_id=? AND status='closed' AND substr(closed_at,1,10)=?").bind(sessionId,day).first<any>();
      if(Number(pnl?.pnl||0)<=-Number(s.daily_loss_limit_usd)) violations.push("Daily realized loss limit reached");
    }
    if(s.cooldown_minutes>0) {
      const last=await db.prepare("SELECT closed_at FROM paper_positions WHERE session_id=? AND status='closed' ORDER BY closed_at DESC LIMIT 1").bind(sessionId).first<any>();
      if(last?.closed_at&&Date.now()-Date.parse(last.closed_at)<Number(s.cooldown_minutes)*60000) violations.push("Trading cooldown is active after your last closed position");
    }
    if(violations.length) {
      for(const v of violations) await db.prepare("INSERT INTO portfolio_risk_events(id,session_id,event_type,message,created_at) VALUES(?,?,?,?,?)").bind(uid(),sessionId,"paper_buy_blocked",v,now()).run();
      return {allowed:false,violations};
    }
    return {allowed:true};
  }

  static async getWalletLeaderboard(db:D1Database, limit=50) {
    // Observed activity leaderboard only. This is not a profitability or "smart money" ranking.
    const rows=await db.prepare(`SELECT wallet_address,COUNT(DISTINCT mint) AS tokens_observed,
      COUNT(DISTINCT signature) AS observed_transactions,MAX(observed_at) AS last_seen_at
      FROM wallet_activities WHERE wallet_address IS NOT NULL
      GROUP BY wallet_address ORDER BY tokens_observed DESC,observed_transactions DESC LIMIT ?`).bind(limit).all<any>();
    return (rows.results||[]).map((r:any,i:number)=>({...r,rank:i+1,rankingBasis:"observed wallet activity",profitabilityVerified:false}));
  }

  static async replaySignals(db:D1Database, mint?:string, limit=200) {
    const rows=await db.prepare(`SELECT s.mint,t.symbol,s.observed_at,s.price_usd,s.momentum_score,r.risk_score,
      (SELECT COUNT(*) FROM alerts a WHERE a.subject_id=s.mint AND a.created_at<=s.observed_at) alerts_at_time
      FROM token_snapshots s JOIN tokens t ON t.mint=s.mint
      LEFT JOIN risk_assessments r ON r.id=(
        SELECT rx.id FROM risk_assessments rx WHERE rx.mint=s.mint AND rx.assessed_at<=s.observed_at
        ORDER BY rx.assessed_at DESC LIMIT 1
      )
      WHERE s.price_usd>0 AND (? IS NULL OR s.mint=?)
      ORDER BY s.observed_at DESC LIMIT ?`).bind(mint||null,mint||null,limit).all<any>();
    return rows.results||[];
  }

  static simulateExecution(input:{side:"buy"|"sell";amountUsd:number;priceUsd:number;liquidityUsd:number;slippageBps:number;feeBps:number}) {
    const {side,amountUsd,priceUsd,liquidityUsd}=input;
    if(![amountUsd,priceUsd,liquidityUsd].every(Number.isFinite)||amountUsd<=0||priceUsd<=0||liquidityUsd<=0) throw new Error("Positive amount, price and liquidity are required");
    const participation=amountUsd/liquidityUsd;
    const impactBps=Math.min(5000,Math.sqrt(participation)*10000);
    const adverseBps=input.slippageBps+impactBps;
    const fillPrice=priceUsd*(side==="buy"?1+adverseBps/10000:1-adverseBps/10000);
    const fee=amountUsd*input.feeBps/10000;
    const estimatedImpactUsd=amountUsd*impactBps/10000;
    return {side,referencePriceUsd:priceUsd,estimatedFillPriceUsd:Number(fillPrice.toPrecision(12)),estimatedFeeUsd:Number(fee.toFixed(6)),estimatedImpactUsd:Number(estimatedImpactUsd.toFixed(6)),estimatedSlippageBps:Number(adverseBps.toFixed(2)),liquidityParticipationPct:Number((participation*100).toFixed(4)),warning:participation>0.05?"Order is large relative to reported liquidity; actual execution may be materially worse":"Estimate only; actual routing and execution can differ"};
  }

  static async saveStrategy(db:D1Database,sessionId:string,input:any) {
    const name=String(input.name||"").trim();
    if(!name) throw new Error("Strategy name is required");
    const config=input.config||{};
    const id=String(input.id||uid());
    await db.prepare(`INSERT INTO strategy_templates(id,session_id,name,description,config_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,config_json=excluded.config_json,updated_at=excluded.updated_at
      WHERE strategy_templates.session_id=excluded.session_id`)
      .bind(id,sessionId,name,String(input.description||""),JSON.stringify(config),now(),now()).run();
    return {id,saved:true};
  }

  static async listStrategies(db:D1Database,sessionId:string) {
    const r=await db.prepare("SELECT * FROM strategy_templates WHERE session_id=? ORDER BY updated_at DESC LIMIT 100").bind(sessionId).all<any>();
    return r.results||[];
  }
}
