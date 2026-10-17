"""Jokić paper: every computed figure. Inputs: papers/common/rs.csv, pipeline.csv, hist.csv, the644 CSV.
Run from repo root: python3 papers/jokic/analysis.py"""
import sys

import pandas as pd

sys.path.insert(0, 'papers/common')
import gravity_rs as g

rs = pd.read_csv('papers/common/rs.csv')
h = pd.read_csv('papers/common/hist.csv')
m = pd.read_csv('the644/the644-2026-07.csv')
pl = pd.read_csv('papers/common/pipeline.csv').set_index('player').loc['Nikola Jokić']
PID = 'jokicni01'
q = rs[rs.mp >= 1500].copy()
q['rk'] = q.groupby('season').impact.rank(ascending=False, method='min')


def rank_of(score):
    return int((m.score > score).sum() + 1)


print('A. Career (GRAVITY-RS) with league rank among 1,500-minute players')
k = rs[rs.pid == PID].merge(q[['pid', 'season', 'rk']], on=['pid', 'season'], how='left')
print(k[['season', 'age', 'g', 'mp', 'ts', 'bpm', 'impact', 'pct', 'rk']].round(3).to_string(index=False))
second = []
for y in range(2021, 2027):
    s = q[q.season == y].sort_values('impact', ascending=False)
    second.append((y, s.iloc[0].player, round(s.iloc[0].impact, 2), s.iloc[1].player, round(s.iloc[1].impact, 2),
                   round(s.iloc[0].impact - s.iloc[1].impact, 2)))
print(pd.DataFrame(second, columns=['season', 'first', 'imp1', 'second', 'imp2', 'gap']).to_string(index=False))

print('\nB. Pipeline')
print(pl[['score', 'rank', 'i26_model', 'i26_rs', 'i25_rs', 'w', 'R', 'pi', 'alpha', 'A', 'Phi', 'pts_pi', 'score_no_pi']].to_string())
jm = m[m.player == 'Nikola Jokić'].iloc[0]
print('   playoff: MP', jm.mp_playoffs, 'BPM', jm.bpm_playoffs, 'vs RS', jm.bpm26)

print('\nC. Robustness of #1 in 2025-26: single-input rankings among 1,500-minute players')
s26 = q[q.season == 2026]
for col in ('impact', 'bpm', 'vorp', 'ws48', 'S', 'z_bpm'):
    t = s26.sort_values(col, ascending=False)
    print(f'   {col:7s}: 1 {t.iloc[0].player} {t.iloc[0][col]:.3f} | 2 {t.iloc[1].player} {t.iloc[1][col]:.3f}')

print('\nD. Aging: seasons at age 30-31 with RS impact >= 2.5 (1,500+ min) -> next season')
a = q[q.age.between(30, 31) & (q.impact >= 2.5) & (q.pid != PID)]
nx = rs[['pid', 'season', 'impact', 'mp']].rename(columns={'season': 's2', 'impact': 'i2', 'mp': 'm2'})
nq = q[['pid', 'season', 'rk']].rename(columns={'season': 's2', 'rk': 'rk2'})
j = a.merge(nx, on='pid', how='left')
j = j[j.s2 == j.season + 1].merge(nq, on=['pid', 's2'], how='left')
print(j[['player', 'season', 'age', 'impact', 'rk', 'i2', 'm2', 'rk2']].sort_values('impact', ascending=False).round(2).to_string(index=False))
print('   n =', len(a), '| next season played:', len(j), '| median change:', round((j.i2 - j.impact).median(), 2),
      '| still #1:', int((j.rk2 == 1).sum()), '| of those who were #1:', int((j.rk == 1).sum()))

print('\nE. How often the league #1 (RS impact, 1,500+ min) repeated, 1977-78 to 2025-26')
lead = q.loc[q.groupby('season').impact.idxmax()].set_index('season')
rep = [(y, lead.loc[y, 'player'], lead.loc[y, 'pid'] == lead.loc[y + 1, 'pid']) for y in range(1978, 2026)]
r = pd.DataFrame(rep, columns=['season', 'leader', 'repeat'])
print('   repeats:', int(r.repeat.sum()), 'of', len(r))
streak = r.copy()
print('   leaders by count:', lead.player.value_counts().head(6).to_dict())
# conditional: leader who had already led 3+ straight seasons
cnt, prev, cond = 0, None, []
for y in range(1978, 2026):
    p = lead.loc[y, 'pid']
    cnt = cnt + 1 if p == prev else 1
    prev = p
    if cnt >= 3:
        cond.append((y, lead.loc[y, 'player'], cnt, lead.loc[y + 1, 'pid'] == p))
print('   after 3+ straight seasons at #1:', sum(c[3] for c in cond), 'of', len(cond), cond)

print('\nF. BPM leader repeats (hist.csv, 1,500+ min), 1973-74 to 2025-26')
hq = h[h.mp >= 1500]
bl = hq.loc[hq.groupby('season').bpm.idxmax()].set_index('season')
brep = [(y, bl.loc[y, 'pid'] == bl.loc[y + 1, 'pid']) for y in range(1974, 2026)]
print('   repeats:', sum(b for _, b in brep), 'of', len(brep))
print('   2021-2026 leaders:', bl.loc[2021:2026, ['player', 'bpm']].to_string())
cnt, prev, bcond = 0, None, []
for y in range(1974, 2026):
    p = bl.loc[y, 'pid']
    cnt = cnt + 1 if p == prev else 1
    prev = p
    if cnt >= 3:
        bcond.append((y, bl.loc[y, 'player'], cnt, bl.loc[y + 1, 'pid'] == p))
print('   after 3+ straight:', sum(c[3] for c in bcond), 'of', len(bcond))
print('  ', bcond)

print('\nG. Rivals and scenarios for July 2027 (age 31)')
i26, m26, g26, mpg26 = pl.i26_model, pl.m26, pl.g26, pl.mpg26
print('   Jokić repeat (65 G, 2265 MP, no playoff term):', round(g.project_score(i26, m26, g26, mpg26, i26, m26, g26, mpg26, 31), 1))
riv = {}
for name, pid in [('Shai Gilgeous-Alexander', 'gilgesh01'), ('Victor Wembanyama', 'wembavi01'), ('Luka Dončić', 'doncilu01')]:
    row = m[m.player == name].iloc[0]
    p25 = rs[(rs.pid == pid) & (rs.season == 2025)].iloc[0]
    rg26, rm26 = float(row.gp26), float(row.mp26)
    rmpg = rm26 / rg26
    pi = g.playoff_term(row.bpm_playoffs, row.bpm26, row.mp_playoffs) if pd.notna(row.mp_playoffs) else 0.0
    ri26, _ = g.backout_current_impact(row.score, p25.impact, rm26, p25.mp, rg26, p25.g, rmpg, p25.mp / p25.g, row.age, pi)
    rep = g.project_score(ri26, rm26, rg26, rmpg, ri26, rm26, rg26, rmpg, row.age + 1)
    up = g.project_score(ri26 + 0.4, 72 * rmpg, 72, rmpg, ri26, rm26, rg26, rmpg, row.age + 1)
    riv[name] = (round(ri26, 2), round(rep, 1), round(up, 1))
    print(f'   {name}: i26 {ri26:.2f} | repeat -> {rep:.1f} | +0.4 and 72 G -> {up:.1f}')
sc = [('Bust', 0.10, 2.40, 40, 34), ('Bear', 0.20, 2.95, 62, 34), ('Base', 0.45, 3.25, 68, 35), ('Bull', 0.25, 3.50, 72, 35)]
for lab, wgt, imp, gp, mpg in sc:
    s = g.project_score(imp, gp * mpg, gp, mpg, i26, m26, g26, mpg26, 31)
    print(f'   {lab}: w={wgt} impact {imp:+.2f} GP {gp} -> {s:.1f}')

print('\nH. Aging delta for stars: players with RS impact >= 2.0 at 30 (1,500+ min both years), change to 31')
st = q[(q.age == 30) & (q.impact >= 2.0)]
jj = st.merge(q[['pid', 'season', 'impact']].rename(columns={'season': 's2', 'impact': 'i2'}), on='pid')
jj = jj[jj.s2 == jj.season + 1]
print('   n =', len(jj), '| median change:', round((jj.i2 - jj.impact).median(), 2), '| mean:', round((jj.i2 - jj.impact).mean(), 2),
      '| held within 0.10 or improved:', int(((jj.i2 - jj.impact) >= -0.10).sum()))
print('   unclipped 2025-26 BPM z for Jokić:')
w = rs[(rs.season == 2026) & (rs.mp >= 200)]
import numpy as np
mu = np.average(w.bpm, weights=w.mp); sd = np.sqrt(np.average((w.bpm - mu) ** 2, weights=w.mp))
print('   ', round((14.2 - mu) / sd, 2), '(clipped to 4.0); SGA', round((11.7 - mu) / sd, 2))
print('\nI. Revised scenarios')
base_imp = round(i26 + (jj.i2 - jj.impact).median(), 2)
sc = [('Bust', 0.10, 2.40, 40, 34), ('Bear', 0.30, round(i26 - 0.42, 2), 65, 34.5), ('Base', 0.35, base_imp, 68, 34.5), ('Bull', 0.25, 3.50, 70, 35)]
for lab, wgt, imp, gp, mpg in sc:
    s = g.project_score(imp, gp * mpg, gp, mpg, i26, m26, g26, mpg26, 31)
    print(f'   {lab}: w={wgt} impact {imp:+.2f} GP {gp} -> {s:.1f}')
for name, pid in [('Victor Wembanyama', 'wembavi01')]:
    row = m[m.player == name].iloc[0]
    p25 = rs[(rs.pid == pid) & (rs.season == 2025)].iloc[0]
    pi = g.playoff_term(row.bpm_playoffs, row.bpm26, row.mp_playoffs)
    ri26, _ = g.backout_current_impact(row.score, p25.impact, row.mp26, p25.mp, row.gp26, p25.g, row.mp26 / row.gp26, p25.mp / p25.g, row.age, pi)
    for d in (0.8,):
        print(f'   Wembanyama +{d} and 72 G:', round(g.project_score(ri26 + d, 72 * 29.2, 72, 29.2, ri26, row.mp26, row.gp26, row.mp26 / row.gp26, 23), 1))
