"""The GRAVITY pipeline for the five preseason-paper players, step by step (spec eqs. blend, cred,
po, age, avail, role, final), anchored to the published July 2026 score.

Inputs: the644/the644-2026-07.csv (published score, 2025-26 G/MP, playoff MP/BPM),
        papers/common/rs.csv (GRAVITY-RS impacts; 2024-25 RS impact stands in for the model's
        2024-25 impact, whose on/off input is licensed and unpublished).
The 2025-26 impact I_26 is backed out from the published score by inverting spec eq. final.
Run from repo root: python3 papers/common/pipeline.py
"""
import sys

import pandas as pd

sys.path.insert(0, 'papers/common')
import gravity_rs as g

m = pd.read_csv('the644/the644-2026-07.csv')
rs = pd.read_csv('papers/common/rs.csv')
PIDS = {'Kawhi Leonard': 'leonaka01', 'Jalen Duren': 'durenja01', 'Nikola Jokić': 'jokicni01',
        'Cooper Flagg': 'flaggco01', 'Jalen Brunson': 'brunsja01'}


def pipeline(name):
    row = m[m.player == name].iloc[0]
    pid = PIDS[name]
    r26 = rs[(rs.pid == pid) & (rs.season == 2026)].iloc[0]
    p25 = rs[(rs.pid == pid) & (rs.season == 2025)]
    g26, m26 = float(row.gp26), float(row.mp26)
    mpg26 = m26 / g26
    if len(p25):
        p = p25.iloc[0]
        g25, m25, mpg25, i25 = float(p.g), float(p.mp), float(p.mp) / float(p.g), float(p.impact)
    else:
        g25 = m25 = mpg25 = i25 = 0.0
    age = float(row.age)
    mpo = float(row.mp_playoffs) if pd.notna(row.mp_playoffs) else 0.0
    bpo = float(row.bpm_playoffs) if pd.notna(row.bpm_playoffs) else 0.0
    pi = g.playoff_term(bpo, float(row.bpm26), mpo) if mpo else 0.0
    i26, info = g.backout_current_impact(float(row.score), i25, m26, m25, g26, g25, mpg26, mpg25, age, pi)
    mass = info['A'] * info['Phi']
    out = dict(player=name, rank=int(row['rank']), score=float(row.score), age=age,
               g26=g26, m26=m26, mpg26=round(mpg26, 1), g25=g25, m25=m25, mpg25=round(mpg25, 1),
               i26_model=round(i26, 3), i26_rs=round(float(r26.impact), 3), pct26_rs=int(r26.pct),
               i25_rs=round(i25, 3), w=round(info['w'], 3), R=round(info['R'], 3), c=round(info['c'], 3),
               Rt=round(info['Rt'], 3), pi=round(pi, 3), alpha=round(g.age_term(age), 3),
               A=round(info['A'], 3), Phi=round(info['Phi'], 3),
               pts_pi=round(15 * pi * mass, 1), pts_alpha=round(15 * g.age_term(age) * mass, 1),
               score_no_pi=round(float(row.score) - 15 * pi * mass, 1),
               score_no_alpha=round(float(row.score) - 15 * g.age_term(age) * mass, 1))
    return out


if __name__ == '__main__':
    rows = [pipeline(n) for n in PIDS]
    df = pd.DataFrame(rows)
    pd.set_option('display.width', 250)
    print(df.T.to_string())
    df.to_csv('papers/common/pipeline.csv', index=False)
