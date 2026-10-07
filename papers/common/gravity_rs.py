"""GRAVITY-RS season impact, implemented from papers/spec.tex (sec. "The retrospective variant").

  I_RS = [0.533 z_BPM + 0.133 z_WS/48 + 0.333 S'] * sqrt(min(1, m/800))
  S'   = .28 z_vol + .21 z_eff + .22 z_crea + .09 z_load + .10 z_stk + .06 z_reb + .04 z_rim
  eff  = (TS - mu_TS) * 100 * (clip(USG, 8, 36) / 20)^0.7     crea = AST% - 0.55 TOV%
  load = USG + 0.4 AST%     stk = 2 STL% + 1.2 BLK%     reb = TRB%     rim = 100 FTr (RS: FT rate only)
  vol  = points per 100 possessions
z-scores: minutes-weighted mean and SD within season, clipped at +-4 (spec eq. z).
Moment set: players with 200+ minutes (the lab convention; the spec leaves the qualifying set implicit).
Seasons: 1977-78 onward (first season with turnover data, needed for TOV% and USG%).

Also: project_score() applies the spec's two-year blend, credibility shrink, age term and
reliability multipliers (spec eqs. blend, cred, age, avail, role, final) to price a 2026-27 scenario.

Inputs: lab/data/adv_YYYY.html and poss_YYYY.html (Basketball Reference league tables).
Run from repo root: python3 papers/common/gravity_rs.py  -> papers/common/rs.csv
"""
import math
import os
import re
import sys

import numpy as np
import pandas as pd
from bs4 import BeautifulSoup

D = os.environ.get('BBREF_DIR', 'lab/data')
OUT = os.environ.get('RS_OUT', 'papers/common/rs.csv')
RHO = -1.9

ADV = {'age': 'age', 'team': ('team_id', 'team_name_abbr'), 'pos': 'pos', 'g': ('g', 'games'),
       'mp': ('mp', 'minutes'), 'bpm': 'bpm', 'obpm': 'obpm', 'dbpm': 'dbpm', 'vorp': 'vorp',
       'ws48': 'ws_per_48', 'ts': 'ts_pct', 'usg': 'usg_pct', 'ast': 'ast_pct', 'tov': 'tov_pct',
       'stl': 'stl_pct', 'blk': 'blk_pct', 'trb': 'trb_pct', 'ftr': 'fta_per_fga_pct',
       'par3': 'fg3a_per_fga_pct'}
POSS = {'pts100': ('pts_per_poss', 'pts_per_100_poss')}


def _rows(path, want):
    html = open(path, encoding='utf-8').read().replace('<!--', '').replace('-->', '')
    soup = BeautifulSoup(html, 'html.parser')
    tbl = soup.find('table', id=re.compile(r'(advanced|per_poss)'))
    if tbl is None:
        return {}
    seen = {}
    for tr in tbl.find_all('tr'):
        pc = tr.find(attrs={'data-stat': re.compile('^(player|name_display)$')})
        if not pc:
            continue
        a = pc.find('a')
        pid = pc.get('data-append-csv') or (re.search(r'/players/\w/(\w+)\.html', a['href']).group(1) if a else None)
        if not pid:
            continue
        cells = {td.get('data-stat'): td.get_text(strip=True) for td in tr.find_all(['td', 'th'])}
        rec = {'pid': pid, 'player': pc.get_text(strip=True).rstrip('*')}
        for k, keys in want.items():
            for key in (keys if isinstance(keys, tuple) else (keys,)):
                if cells.get(key):
                    rec[k] = cells[key]
                    break
        team = rec.get('team', '')
        tot = bool(re.match(r'^(TOT|\dTM)$', team))
        if pid not in seen or (tot and not seen[pid][0]):
            seen[pid] = (tot, rec)
    return {k: v[1] for k, v in seen.items()}


def _z(x, w):
    mu = np.average(x, weights=w)
    sd = math.sqrt(np.average((x - mu) ** 2, weights=w)) or 1.0
    return mu, sd


def season(y):
    adv = _rows(f'{D}/adv_{y}.html', ADV)
    poss = _rows(f'{D}/poss_{y}.html', {'team': ('team_id', 'team_name_abbr'), **POSS})
    rows = []
    for pid, a in adv.items():
        p = poss.get(pid)
        if not p or 'pts100' not in p:
            continue
        r = {'season': y, **a, 'pts100': p['pts100']}
        rows.append(r)
    df = pd.DataFrame(rows)
    num = [c for c in list(ADV) + ['pts100'] if c not in ('team', 'pos')]
    for c in num:
        df[c] = pd.to_numeric(df.get(c), errors='coerce')
    df = df.dropna(subset=['mp', 'bpm', 'ws48', 'ts', 'usg', 'ast', 'tov', 'stl', 'blk', 'trb', 'ftr', 'pts100'])
    q = df[df.mp >= 200]
    mu_ts, _ = _z(q.ts.values, q.mp.values)
    df['eff'] = (df.ts - mu_ts) * 100 * (df.usg.clip(8, 36) / 20) ** 0.7
    df['crea'] = df.ast - 0.55 * df.tov
    df['load'] = df.usg + 0.4 * df.ast
    df['stk'] = 2.0 * df.stl + 1.2 * df.blk
    df['reb'] = df.trb
    df['rim'] = 100.0 * df.ftr
    df['vol'] = df.pts100
    q = df[df.mp >= 200]
    for c in ('bpm', 'ws48', 'vol', 'eff', 'crea', 'load', 'stk', 'reb', 'rim'):
        mu, sd = _z(q[c].values, q.mp.values)
        df['z_' + c] = ((df[c] - mu) / sd).clip(-4, 4)
    df['S'] = (0.28 * df.z_vol + 0.21 * df.z_eff + 0.22 * df.z_crea + 0.09 * df.z_load
               + 0.10 * df.z_stk + 0.06 * df.z_reb + 0.04 * df.z_rim)
    df['impact'] = (0.533 * df.z_bpm + 0.133 * df.z_ws48 + 0.333 * df.S) * np.sqrt(np.minimum(1, df.mp / 800))
    ref = df[df.mp >= 1000].impact.values
    df['pct'] = df.impact.apply(lambda v: round(100 * (ref < v).mean()))
    return df


def age_term(age):
    a = 0.055 * (24 - age) if age <= 23 else 0.0
    if age >= 31:
        a = -0.045 * (age - 30)
    return max(-0.30, min(0.25, a))


def project_score(i_new, m_new, g_new, mpg_new, i_prev, m_prev, g_prev, mpg_prev, age, pi=0.0, J=1.0):
    """Spec pipeline for a season that has not happened yet (pi = playoff term, default 0)."""
    w = 0.75 * m_new / (0.75 * m_new + 0.25 * m_prev) if (m_new + m_prev) else 1.0
    R = w * i_new + (1 - w) * i_prev
    c = math.sqrt(min(m_new + m_prev, 2200) / 2200)
    Rt = c * R + (1 - c) * RHO
    A = 0.78 + 0.22 * min(1, (0.7 * g_new + 0.3 * g_prev) / 55)
    Phi = 0.62 + 0.38 * min(1, max(mpg_new, 0.85 * mpg_prev) / 32)
    return 50 + 15 * (RHO + (Rt + pi + age_term(age) - RHO) * A * Phi * J)


def backout_current_impact(G, i_prev, m_now, m_prev, g_now, g_prev, mpg_now, mpg_prev, age, pi, J=1.0):
    """Invert the spec's final score for this season's impact I_y, given last season's impact."""
    A = 0.78 + 0.22 * min(1, (0.7 * g_now + 0.3 * g_prev) / 55)
    Phi = 0.62 + 0.38 * min(1, max(mpg_now, 0.85 * mpg_prev) / 32)
    Rt = ((G - 50) / 15 - RHO) / (A * Phi * J) + RHO - pi - age_term(age)
    c = math.sqrt(min(m_now + m_prev, 2200) / 2200)
    R = (Rt - (1 - c) * RHO) / c
    w = 0.75 * m_now / (0.75 * m_now + 0.25 * m_prev) if m_prev else 1.0
    return (R - (1 - w) * i_prev) / w, dict(A=A, Phi=Phi, R=R, Rt=Rt, c=c, w=w)


def playoff_term(bpm_po, bpm_rs, m_po):
    return max(-0.30, min(0.30, 0.12 * (bpm_po - bpm_rs) * min(1, m_po / 300) / 2.6))


if __name__ == '__main__':
    frames = []
    for y in range(1978, 2027):
        if not (os.path.exists(f'{D}/adv_{y}.html') and os.path.exists(f'{D}/poss_{y}.html')):
            print('skip', y, file=sys.stderr)
            continue
        frames.append(season(y))
    rs = pd.concat(frames, ignore_index=True)
    rs.to_csv(OUT, index=False)
    print('wrote', OUT, len(rs), 'player-seasons', rs.season.min(), '-', rs.season.max())
