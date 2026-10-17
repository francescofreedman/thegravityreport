"""Jokić rewrite: every season's data #1 (GRAVITY-RS, 1,500+ min), 1977-78 to 2025-26; margins; MVP match; streaks.
Inputs: papers/common/rs.csv, papers/common/mvp.csv (bbref awards/mvp.html). Run from repo root."""
import pandas as pd
rs = pd.read_csv('papers/common/rs.csv')
mvp = pd.read_csv('papers/common/mvp.csv').rename(columns={'pid': 'mvp_pid', 'player': 'mvp'})
q = rs[rs.mp >= 1500].copy()
q['rk'] = q.groupby('season').impact.rank(ascending=False, method='first')
rows = []
for y, s in q.groupby('season'):
    s = s.sort_values('impact', ascending=False)
    a, b = s.iloc[0], s.iloc[1]
    rows.append(dict(season=y, first=a.player, pid=a.pid, age=a.age, imp1=round(a.impact, 2), second=b.player,
                     imp2=round(b.impact, 2), margin=round(a.impact - b.impact, 2)))
t = pd.DataFrame(rows).merge(mvp, on='season', how='left')
t['mvp_is_first'] = t.pid == t.mvp_pid
mr = q[['pid', 'season', 'rk']].rename(columns={'pid': 'mvp_pid', 'rk': 'mvp_data_rank'})
t = t.merge(mr, on=['mvp_pid', 'season'], how='left')
# next-season rank of the #1
nr = q[['pid', 'season', 'rk']].copy(); nr['season'] -= 1
t = t.merge(nr.rename(columns={'rk': 'next_rank'}), on=['pid', 'season'], how='left')
# streaks
streak, prev = [], None
for _, r in t.iterrows():
    streak.append(streak[-1] + 1 if prev == r.pid else 1); prev = r.pid
t['streak'] = streak
pd.set_option('display.width', 250)
print(t[['season', 'first', 'age', 'imp1', 'second', 'imp2', 'margin', 'mvp', 'mvp_data_rank', 'mvp_is_first', 'next_rank', 'streak']].to_string(index=False))
print('\nMVP went to the data #1:', int(t.mvp_is_first.sum()), 'of', len(t))
by = t.groupby('first').agg(seasons=('season', 'size'), mvps_while_first=('mvp_is_first', 'sum'),
                            mean_margin=('margin', 'mean'), best_streak=('streak', 'max')).sort_values('seasons', ascending=False)
by['lost'] = by.seasons - by.mvps_while_first
print(by.head(10).round(2).to_string())
# best runs: mean impact and mean margin over each maximal streak of length >= 3
runs = []
cur = []
for _, r in t.iterrows():
    if cur and r.pid != cur[-1].pid:
        runs.append(cur); cur = []
    cur.append(r)
runs.append(cur)
R = pd.DataFrame([dict(player=c[0]['first'], start=c[0].season, end=c[-1].season, n=len(c),
                       mean_imp=round(sum(x.imp1 for x in c) / len(c), 2), mean_margin=round(sum(x.margin for x in c) / len(c), 2),
                       mvps=int(sum(x.mvp_is_first for x in c))) for c in runs if len(c) >= 3]).sort_values('n', ascending=False)
print('\nRuns of 3+ straight seasons at #1:'); print(R.to_string(index=False))
t.to_csv('papers/jokic/history.csv', index=False)
