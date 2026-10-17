"""Duren paper: every computed figure. Inputs: papers/common/rs.csv, papers/common/pipeline.csv,
papers/common/hist.csv, the644/the644-2026-07.csv. Run from repo root: python3 papers/duren/analysis.py"""
import sys

import pandas as pd

sys.path.insert(0, 'papers/common')
import gravity_rs as g

rs = pd.read_csv('papers/common/rs.csv')
h = pd.read_csv('papers/common/hist.csv')
m = pd.read_csv('the644/the644-2026-07.csv')
pl = pd.read_csv('papers/common/pipeline.csv').set_index('player').loc['Jalen Duren']
PID = 'durenja01'
rs['isC'] = rs.pos.astype(str).str.contains('C')
h['isC'] = h.pos.astype(str).str.contains('C')


def rank_of(score):
    return int((m.score > score).sum() + 1)


print('A. Career (GRAVITY-RS)')
print(rs[rs.pid == PID][['season', 'g', 'mp', 'ts', 'usg', 'trb', 'bpm', 'impact', 'pct', 'par3']].round(3).to_string(index=False))

print('\nB. 2025-26 centers (bbref pos C), 1,500+ min, by GRAVITY-RS impact')
c = rs[(rs.season == 2026) & rs.isC & (rs.mp >= 1500)].sort_values('impact', ascending=False)
print('   n =', len(c))
print(c[['player', 'age', 'mp', 'impact', 'pct', 'bpm', 'par3']].head(8).round(3).to_string(index=False))
t = c[c.par3 < 0.10]
print('   traditional (3PAr < .10): n =', len(t))
print(t[['player', 'age', 'mp', 'impact', 'pct', 'bpm', 'par3']].round(3).to_string(index=False))
print('   model (the644) centers:', m[m.pos == 'C'].sort_values('rank')[['rank', 'player', 'score']].head(6).to_string(index=False))

print('\nC. Pipeline (pipeline.csv)')
print(pl[['score', 'rank', 'i26_model', 'i26_rs', 'i25_rs', 'w', 'R', 'pi', 'alpha', 'A', 'Phi', 'pts_pi', 'pts_alpha', 'score_no_pi']].to_string())
print('   rank without playoff term:', rank_of(pl.score_no_pi), '| playoff: 14 G, 422 MP, BPM -1.7 vs RS 5.0')

print('\nD. The playoff term across all 644 (spec eq. po, CSV mp_playoffs / bpm_playoffs / bpm26)')
pp = m[m.mp_playoffs.notna() & (m.mp_playoffs > 0)].copy()
pp['pi'] = [g.playoff_term(b, r, mm) for b, r, mm in zip(pp.bpm_playoffs, pp.bpm26, pp.mp_playoffs)]
print('   players with playoff minutes:', len(pp), '| at the -0.30 floor:', int((pp.pi <= -0.2999).sum()),
      '| at the +0.30 cap:', int((pp.pi >= 0.2999).sum()))
fl = pp[pp.pi <= -0.2999].sort_values('rank')[['rank', 'player', 'bpm26', 'bpm_playoffs', 'mp_playoffs']]
print(fl.to_string(index=False))
print('   top-30 players by 644 rank at the floor:', fl[fl['rank'] <= 30].player.tolist())

print('\nE. Comparables: centers aged 21-23, RS impact >= 1.2, 1,500+ min, 1977-78 to 2024-25 -> next season')
bar = None
i26, m26, g26, mpg26 = pl.i26_model, pl.m26, pl.g26, pl.mpg26
for target, lab in ((65.8, '#15'), (67.3, '#10')):
    lo, hi = -2.0, 5.0
    for _ in range(60):
        mid = (lo + hi) / 2
        s = g.project_score(mid, 72 * 29, 72, 29.0, i26, m26, g26, mpg26, 23)
        lo, hi = (mid, hi) if s < target else (lo, mid)
    print(f'   bar for {lab} ({target}) at 72 G x 29 mpg: impact {hi:.2f}')
    if lab == '#15':
        bar = round(hi, 2)
a = rs[rs.isC & rs.age.between(21, 23) & (rs.impact >= 1.2) & (rs.mp >= 1500) & (rs.season <= 2025) & (rs.pid != PID)]
nx = rs[['pid', 'season', 'impact', 'mp', 'pct']].rename(columns={'season': 's2', 'impact': 'i2', 'mp': 'm2', 'pct': 'p2'})
j = a.merge(nx, on='pid', how='left')
j = j[j.s2 == j.season + 1]
print('   n =', len(a), 'seasons,', a.pid.nunique(), 'players | with next season:', len(j))
print(j[['player', 'season', 'age', 'impact', 'pct', 'i2', 'm2', 'p2']].sort_values('impact', ascending=False).round(2).to_string(index=False))
print('   median change:', round((j.i2 - j.impact).median(), 2), '| next 1,500+ min:', int((j.m2 >= 1500).sum()),
      f'| cleared bar {bar} with 1,500+:', int(((j.i2 >= bar) & (j.m2 >= 1500)).sum()),
      '| improved:', int((j.i2 > j.impact).sum()))

print('\nF. Sensitivity (share clearing the #15 bar with 1,500+ min next season)')
rows = []
for lab, cond in [('As defined (C, 21-23, >=1.2, 1500)', lambda d: d.isC & d.age.between(21, 23) & (d.impact >= 1.2) & (d.mp >= 1500)),
                  ('impact >= 1.0', lambda d: d.isC & d.age.between(21, 23) & (d.impact >= 1.0) & (d.mp >= 1500)),
                  ('impact >= 1.4', lambda d: d.isC & d.age.between(21, 23) & (d.impact >= 1.4) & (d.mp >= 1500)),
                  ('ages 20-24', lambda d: d.isC & d.age.between(20, 24) & (d.impact >= 1.2) & (d.mp >= 1500)),
                  ('any position', lambda d: d.age.between(21, 23) & (d.impact >= 1.2) & (d.mp >= 1500)),
                  ('3PAr < .10 only', lambda d: d.isC & d.age.between(21, 23) & (d.impact >= 1.2) & (d.mp >= 1500) & (d.par3 < 0.10))]:
    s = rs[cond(rs) & (rs.season <= 2025) & (rs.pid != PID)]
    jj = s.merge(nx, on='pid')
    jj = jj[jj.s2 == jj.season + 1]
    ok = int(((jj.i2 >= bar) & (jj.m2 >= 1500)).sum())
    rows.append((lab, len(s), s.pid.nunique(), ok, round(100 * ok / len(s))))
print(pd.DataFrame(rows, columns=['variation', 'seasons', 'players', 'cleared', 'pct']).to_string(index=False))

print('\nG. Scenarios (age 23 in 2026-27)')
sc = [('Bust', 0.15, 0.90, 35, 27), ('Bear', 0.20, 1.05, 70, 28), ('Base', 0.40, 1.45, 72, 29), ('Bull', 0.25, 1.85, 74, 31)]
for lab, wgt, imp, gp, mpg in sc:
    s = g.project_score(imp, gp * mpg, gp, mpg, i26, m26, g26, mpg26, 23)
    print(f'   {lab}: w={wgt} impact {imp:+.2f} GP {gp} mpg {mpg} -> {s:.1f} (#{rank_of(s)})')
print('   repeat check (70 G, 1976 MP, age 23, no playoff term):',
      round(g.project_score(i26, m26, g26, mpg26, i26, m26, g26, mpg26, 23), 1))

print('\nH. Public cross-check: top BPM among traditional centers (C, 3PAr < .10, 1,500+ min)')
tc = h[h.isC & (h.par3 < 0.10) & (h.mp >= 1500)]
lead = tc.loc[tc.groupby('season').bpm.idxmax()].set_index('season')
rep = [(y, lead.loc[y, 'pid'] == lead.loc[y + 1, 'pid']) for y in range(2000, 2026) if y in lead.index and y + 1 in lead.index]
print('   leader repeated:', sum(r for _, r in rep), 'of', len(rep), '(2000-2025 transitions)')
marg = []
for y in range(2000, 2026):
    s = tc[tc.season == y].sort_values('bpm', ascending=False)
    marg.append((y, s.iloc[0].player, round(s.iloc[0].bpm - s.iloc[1].bpm, 1), s.iloc[0].pid == lead.loc[y + 1, 'pid']))
mg = pd.DataFrame(marg, columns=['season', 'leader', 'margin', 'repeat'])
print('   margin >= 2.0:', mg[mg.margin >= 2.0].to_string(index=False))
s26 = tc[tc.season == 2026].sort_values('bpm', ascending=False)
print('   2025-26:', s26[['player', 'bpm', 'par3', 'mp']].head(4).to_string(index=False))
