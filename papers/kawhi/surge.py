"""Kawhi rewrite: the surge. Late rebounds, their persistence, and a component-by-component forecast.
Input: papers/common/rs.csv. Run from repo root: python3 papers/kawhi/surge.py"""
import sys
import numpy as np
import pandas as pd
sys.path.insert(0, 'papers/common')
import gravity_rs as g

rs = pd.read_csv('papers/common/rs.csv')
P = 'leonaka01'
a = rs[['pid', 'player', 'season', 'age', 'impact', 'mp', 'usg', 'ts']]
b = a.rename(columns={'season': 's0', 'impact': 'i0', 'mp': 'm0'})[['pid', 's0', 'i0', 'm0']]
j = a.merge(b, on='pid'); j = j[j.s0 == j.season - 1]
j = j[(j.mp >= 1500) & (j.m0 >= 1000)]
j['gain'] = j.impact - j.i0
print('A. Largest one-year gains at age 32+ (1,500 min, prior 1,000+)')
print(j[j.age >= 32].sort_values('gain', ascending=False)[['player', 'season', 'age', 'i0', 'impact', 'gain']].head(6).round(2).to_string(index=False))
print('   largest at 34+:', j[j.age >= 34].sort_values('gain', ascending=False)[['player', 'season', 'gain']].head(3).round(2).values.tolist())

print('\nB. Career highs in usage AND true shooting in the same season at 33+ (1,000+ min, 5+ prior qualifying seasons)')
hits = []
for pid, gp in rs[rs.mp >= 1000].groupby('pid'):
    for _, r in gp[gp.age >= 33].iterrows():
        prior = gp[gp.season < r.season]
        if len(prior) >= 5 and r.usg > prior.usg.max() and r.ts > prior.ts.max():
            hits.append((r.player, int(r.season), int(r.age), r.usg, r.ts, round(r.impact, 2)))
print(pd.DataFrame(hits, columns=['player', 'season', 'age', 'usg', 'ts', 'impact']).to_string(index=False))

print('\nC. Late surges (age 31+, gain >= +0.6): what happened next')
lr = j[(j.age >= 31) & (j.gain >= 0.6)]
n = lr.merge(a.rename(columns={'season': 's2', 'impact': 'i2', 'mp': 'm2'})[['pid', 's2', 'i2', 'm2']], on='pid')
n = n[n.s2 == n.season + 1]
n['kept'] = (n.i2 - n.i0) / (n.impact - n.i0)
print('   surges:', len(lr), '| with a next season:', len(n), '| median change next season:', round((n.i2 - n.impact).median(), 2),
      '| median share of gain kept:', round(n.kept.median(), 2), '| kept 75%+:', int((n.kept >= 0.75).sum()))
print('   the ones who kept it:', n[n.kept >= 0.75].sort_values('impact', ascending=False)[['player', 'season', 'age', 'i0', 'impact', 'i2']].round(2).to_string(index=False))
stars = n[n.impact >= 1.5]
print('   surges to +1.5 or higher:', len(stars), '| median kept', round(stars.kept.median(), 2), '| kept 75%+:', int((stars.kept >= 0.75).sum()))

print('\nD. Component persistence and Kawhi component forecast (players 31+, 1,500 min, neighbors 1,000+)')
comps = ['z_bpm', 'z_ws48', 'z_vol', 'z_eff', 'z_crea', 'z_load', 'z_stk', 'z_reb', 'z_rim']
c0 = rs[['pid', 'season', 'age', 'mp'] + comps]
c1 = c0.rename(columns={c: c + '_1' for c in comps + ['mp', 'season', 'age']})
cn = c0.rename(columns={c: c + '_n' for c in comps + ['mp', 'season', 'age']})
jj = c0.merge(c1, on='pid'); jj = jj[jj.season_1 == jj.season - 1]
jj = jj.merge(cn, on='pid'); jj = jj[jj.season_n == jj.season + 1]
jj = jj[(jj.age >= 31) & (jj.mp >= 1500) & (jj.mp_1 >= 1000) & (jj.mp_n >= 1000)]
k = rs[(rs.pid == P) & rs.season.isin([2025, 2026])].set_index('season')
pred = {}
rows = []
for c in comps:
    X = np.c_[np.ones(len(jj)), jj[c], jj[c + '_1']]
    beta = np.linalg.lstsq(X, jj[c + '_n'], rcond=None)[0]
    pred[c] = beta[0] + beta[1] * k.loc[2026, c] + beta[2] * k.loc[2025, c]
    rows.append((c, round(np.corrcoef(jj[c], jj[c + '_n'])[0, 1], 2), round(k.loc[2025, c], 2), round(k.loc[2026, c], 2), round(pred[c], 2)))
print('   n =', len(jj))
print(pd.DataFrame(rows, columns=['component', 'r_next', '2024-25', '2025-26', '2026-27 forecast']).to_string(index=False))
S = (0.28 * pred['z_vol'] + 0.21 * pred['z_eff'] + 0.22 * pred['z_crea'] + 0.09 * pred['z_load'] + 0.10 * pred['z_stk']
     + 0.06 * pred['z_reb'] + 0.04 * pred['z_rim'])
imp = 0.533 * pred['z_bpm'] + 0.133 * pred['z_ws48'] + 0.333 * S
print('   component-built impact:', round(imp, 2))
ib = a[['pid', 'season', 'age', 'mp', 'impact']]
q = ib.merge(ib.rename(columns={'season': 's1', 'impact': 'i1', 'mp': 'm1', 'age': 'a1'}), on='pid'); q = q[q.s1 == q.season - 1]
q = q.merge(ib.rename(columns={'season': 's2', 'impact': 'i2', 'mp': 'm2', 'age': 'a2'}), on='pid'); q = q[q.s2 == q.season + 1]
q = q[(q.age >= 31) & (q.mp >= 1500) & (q.m1 >= 1000) & (q.m2 >= 1000)]
X = np.c_[np.ones(len(q)), q.impact, q.i1]; bb = np.linalg.lstsq(X, q.i2, rcond=None)[0]
resid = q.i2 - X @ bb
direct = bb[0] + bb[1] * k.loc[2026, 'impact'] + bb[2] * k.loc[2025, 'impact']
print('   direct model: coefficients', bb.round(3), '| forecast', round(direct, 2), '| residual sd', round(resid.std(), 2))
from math import erf, sqrt
for bar in (1.29, 1.15):
    p = 0.5 * (1 + erf((imp - bar) / (resid.std() * sqrt(2))))
    print(f'   P(impact >= {bar}) given forecast {imp:.2f}, sd {resid.std():.2f}: {p:.2f}')
w = rs[(rs.season == 2026) & (rs.mp >= 200)]
mu = np.average(w.bpm, weights=w.mp); sd = np.sqrt(np.average((w.bpm - mu) ** 2, weights=w.mp))
print('   forecast BPM from z_bpm', round(pred['z_bpm'], 2), '->', round(mu + pred['z_bpm'] * sd, 1))

print('\nE. Bars for July 2027 (pipeline.csv trailing season; 32 mpg, 65 games)')
pl = pd.read_csv('papers/common/pipeline.csv').set_index('player').loc['Kawhi Leonard']
m = pd.read_csv('the644/the644-2026-07.csv')
for target, lab in ((69.3, '#8'), (67.3, '#10')):
    lo, hi = -2.0, 5.0
    for _ in range(60):
        mid = (lo + hi) / 2
        s = g.project_score(mid, 65 * 32, 65, 32.0, pl.i26_model, pl.m26, pl.g26, pl.mpg26, 35)
        lo, hi = (mid, hi) if s < target else (lo, mid)
    print(f'   {lab}: impact {hi:.2f}')
print('   projected score at the component forecast (65 G):', round(g.project_score(imp, 65 * 32, 65, 32.0, pl.i26_model, pl.m26, pl.g26, pl.mpg26, 35), 1))

print('\nF. The star-level late surges (age 31+, gain >= +0.6, reached +1.5)')
print(stars.sort_values('season')[['player', 'season', 'age', 'i0', 'impact', 'i2', 'kept']].round(2).to_string(index=False))
