"""Duren rewrite: the non-shooter's disappearance and Duren's place in it.
Input: papers/common/rs.csv (GRAVITY-RS; 3PAr from bbref advanced). Run from repo root."""
import pandas as pd
rs = pd.read_csv('papers/common/rs.csv')
q = rs[(rs.mp >= 1500) & (rs.season >= 1980)].copy()
q['rk'] = q.groupby('season').impact.rank(ascending=False, method='first')
q['ns'] = q.par3 < 0.10
q['pure'] = q.par3 <= 0.02
D = 'durenja01'
d = q[(q.pid == D) & (q.season == 2026)].iloc[0]
print('A. Duren 2025-26: rank', int(d.rk), 'of', int((q.season == 2026).sum()), '| impact', round(d.impact, 2), '| 3PAr', d.par3)
g = q.groupby('season').agg(players=('pid', 'size'), share_ns=('ns', 'mean'),
                            ns_top10=('rk', lambda r: int(q.loc[r.index][r <= 10].ns.sum())),
                            pure_top10=('rk', lambda r: int(q.loc[r.index][r <= 10].pure.sum())))
print('\nB. By season'); print(g.round(3).to_string())
g.to_csv('papers/duren/extinct_series.csv')
print('\nC. Pure non-shooters (3PAr <= .02) in the top 10, 2005 on')
print(q[q.pure & (q.rk <= 10) & (q.season >= 2005)].sort_values('season')[['season', 'player', 'age', 'rk', 'impact', 'par3']].round(2).to_string(index=False))
print('\nD. Best non-shooter (3PAr < .10) seasons at age 22 or younger, 1979-80 on')
print(q[q.ns & (q.age <= 22)].sort_values('impact', ascending=False)[['season', 'player', 'age', 'rk', 'impact', 'par3']].head(10).round(2).to_string(index=False))
print('\nE. Duren components 2025-26 (z)')
for c in ('z_bpm', 'z_ws48', 'z_vol', 'z_eff', 'z_crea', 'z_load', 'z_stk', 'z_reb', 'z_rim'):
    print(f'   {c:7s} {d[c]:+.2f}')
print('   raw TS', d.ts, 'TRB%', d.trb, 'FTr', d.ftr, 'USG', d.usg, 'BPM', d.bpm)
print('\nF. 2025-26 top 10 with 3PAr')
print(q[(q.season == 2026) & (q.rk <= 10)].sort_values('rk')[['rk', 'player', 'impact', 'par3']].round(3).to_string(index=False))
