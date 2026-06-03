"""
Hi Logs 引擎测试套件
RG vs Python 搜索结果一致性验证
所有修改后必须通过此测试才能打包提交
"""
import os
import sys
import unittest
import tempfile
import shutil

# 添加项目根目录
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine.indexer import index_file
from engine.filter_engine import search as search_engine
from engine.search_cache import invalidate


def _make_log(path: str, content: str):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


def _search(indexes, **kwargs):
    """Python 引擎搜索"""
    invalidate()
    kwargs.setdefault('offset', 0)
    kwargs.setdefault('limit', 5000)
    return search_engine(indexes, engine_mode='python', **kwargs)


def _rg_search(indexes, **kwargs):
    """RG 引擎搜索"""
    invalidate()
    kwargs.setdefault('offset', 0)
    kwargs.setdefault('limit', 5000)
    return search_engine(indexes, engine_mode='rg', **kwargs)


def assert_results_equal(test_case, rg_total, py_total, label):
    test_case.assertEqual(
        rg_total, py_total,
        f'{label}: RG={rg_total} ≠ Python={py_total}'
    )


class TestEngineConsistency(unittest.TestCase):
    """RG 与 Python 引擎搜索结果一致性测试"""

    @classmethod
    def setUpClass(cls):
        cls.test_dir = tempfile.mkdtemp(prefix='hilogs_test_')
        cls.indexes = {}

    @classmethod
    def tearDownClass(cls):
        for idx in cls.indexes.values():
            idx.close()
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _load(self, name, content):
        path = os.path.join(self.test_dir, f'{name}.log')
        _make_log(path, content)
        idx = index_file(path)
        self.indexes[name] = idx
        return [idx]

    # ----------------------------------------------------------------
    # 1. 纯级别过滤
    # ----------------------------------------------------------------
    def test_pure_level_filter(self):
        indexes = self._load('pure_level', '''\
06-01 10:00:00.001  100  200 D TagA: debug1
06-01 10:00:00.002  100  200 I TagA: info1
06-01 10:00:00.003  100  200 W TagA: warn1
06-01 10:00:00.004  100  200 E TagA: error1
06-01 10:00:00.005  100  200 D TagB: debug2
06-01 10:00:00.006  100  200 I TagB: info2
06-01 10:00:00.007  100  200 W TagB: warn2
06-01 10:00:00.008  100  200 E TagB: error2
''')
        cases = [
            (['D','I','W','E'], 8, 'all 4 levels'),
            (['D'], 2, 'only D'),
            (['I'], 2, 'only I'),
            (['W'], 2, 'only W'),
            (['E'], 2, 'only E'),
            (['I','W'], 4, 'I+W'),
            (['D','E'], 4, 'D+E'),
            (None, 8, 'no level filter'),
        ]
        for levels, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, levels=levels)
            _, py_total, _ = _search(indexes, levels=levels)
            self.assertEqual(rg_total, expected, f'RG {label}')
            self.assertEqual(py_total, expected, f'Python {label}')

    # ----------------------------------------------------------------
    # 2. 关键字搜索
    # ----------------------------------------------------------------
    def test_keyword_search(self):
        indexes = self._load('keyword', '''\
06-01 10:00:00.001  100  200 I TagA: found error in module
06-01 10:00:00.002  100  200 I TagA: found Error in module
06-01 10:00:00.003  100  200 I TagA: found ERROR in module
06-01 10:00:00.004  100  200 I TagA: no match here
06-01 10:00:00.005  100  200 I TagA: something critical happened
06-01 10:00:00.006  100  200 I TagA: critical path
06-01 10:00:00.007  100  200 I TagA: end of log
''')
        cases = [
            ('error', 3, 'keyword error'),
            ('ERROR', 3, 'keyword ERROR'),
            ('critical', 2, 'keyword critical'),
            ('AnR', 0, 'keyword AnR (no match)'),
        ]
        for kw, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, keyword=kw)
            _, py_total, _ = _search(indexes, keyword=kw)
            assert_results_equal(self, rg_total, py_total, label)
            self.assertEqual(rg_total, expected, f'RG {label}')

    # ----------------------------------------------------------------
    # 3. 关键字 + 级别
    # ----------------------------------------------------------------
    def test_keyword_with_level(self):
        indexes = self._load('kw_level', '''\
06-01 10:00:00.001  100  200 D TagA: error in debug
06-01 10:00:00.002  100  200 I TagA: error in info
06-01 10:00:00.003  100  200 D TagB: another debug error
06-01 10:00:00.004  100  200 I TagB: another info error
''')
        cases = [
            (['D'], 'error', 2, 'D+error'),
            (['I'], 'error', 2, 'I+error'),
        ]
        for levels, kw, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, levels=levels, keyword=kw)
            _, py_total, _ = _search(indexes, levels=levels, keyword=kw)
            assert_results_equal(self, rg_total, py_total, label)
            self.assertEqual(rg_total, expected, label)

    # ----------------------------------------------------------------
    # 4. 规则模式 + 级别
    # ----------------------------------------------------------------
    def test_rule_pattern(self):
        indexes = self._load('rule_pat', '''\
06-01 10:00:00.001  100  200 D TagA: checkpoint ok
06-01 10:00:00.002  100  200 I TagA: checkpoint ok
06-01 10:00:00.003  100  200 W TagA: ANR detected
06-01 10:00:00.004  100  200 E TagA: ANR detected
06-01 10:00:00.005  100  200 D TagA: sync completed
06-01 10:00:00.006  100  200 I TagA: sync completed
06-01 10:00:00.007  100  200 W TagA: crash fatal
06-01 10:00:00.008  100  200 E TagA: crash fatal
''')
        cases = [
            ('checkpoint', None, 2, 'checkpoint'),
            ('ANR', None, 2, 'ANR'),
            ('crash|fatal', ['I','W','E'], 2, 'crash+IWE'),
            ('crash|fatal', ['D'], 0, 'crash+D'),
            ('sync', None, 2, 'sync'),
        ]
        for pattern, levels, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, rule_pattern=pattern, levels=levels)
            _, py_total, _ = _search(indexes, rule_pattern=pattern, levels=levels)
            assert_results_equal(self, rg_total, py_total, label)
            self.assertEqual(rg_total, expected, f'RG {label}')

    # ----------------------------------------------------------------
    # 5. 多规则 OR
    # ----------------------------------------------------------------
    def test_multi_rule_ids(self):
        indexes = self._load('multi_rule', '''\
06-01 10:00:00.001  100  200 I TagA: checkpoint ok
06-01 10:00:00.002  100  200 I TagA: ANR detected
06-01 10:00:00.003  100  200 I TagA: sync completed
06-01 10:00:00.004  100  200 I TagA: crash fatal
''')
        rule_patterns = [(1, 'checkpoint'), (2, 'crash')]
        _, rg_total, _ = _rg_search(indexes, rule_patterns=rule_patterns)
        _, py_total, _ = _search(indexes, rule_patterns=rule_patterns)
        assert_results_equal(self, rg_total, py_total, 'multi rule OR')
        self.assertEqual(rg_total, 2)

    # ----------------------------------------------------------------
    # 6. 规则 + 关键字
    # ----------------------------------------------------------------
    def test_rule_plus_keyword(self):
        indexes = self._load('rule_kw', '''\
06-01 10:00:00.001  100  200 I TagA: sync completed ok
06-01 10:00:00.002  100  200 I TagA: sync failed
06-01 10:00:00.003  100  200 I TagA: data sync started
06-01 10:00:00.004  100  200 I TagA: not matching
''')
        _, rg_total, _ = _rg_search(indexes, rule_pattern='sync', keyword='completed')
        _, py_total, _ = _search(indexes, rule_pattern='sync', keyword='completed')
        assert_results_equal(self, rg_total, py_total, 'rule+keyword')
        self.assertEqual(rg_total, 1)

    # ----------------------------------------------------------------
    # 7. PID 过滤
    # ----------------------------------------------------------------
    def test_pid_filter(self):
        indexes = self._load('pid', '''\
06-01 10:00:00.001  1001  2001 D App: debug
06-01 10:00:00.002  1001  3001 I App: info
06-01 10:00:00.003  2002  4001 W Bt: warn
06-01 10:00:00.004  2002  4001 E Bt: error
06-01 10:00:00.005  1001  2001 D App: debug2
''')
        cases = [
            (1001, 3, 'PID=1001'),
            (2002, 2, 'PID=2002'),
        ]
        for pid, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, pid=pid)
            _, py_total, _ = _search(indexes, pid=pid)
            assert_results_equal(self, rg_total, py_total, label)
            self.assertEqual(rg_total, expected, label)

    # ----------------------------------------------------------------
    # 8. TID 过滤
    # ----------------------------------------------------------------
    def test_tid_filter(self):
        indexes = self._load('tid', '''\
06-01 10:00:00.001  1001  2001 D App: debug
06-01 10:00:00.002  1001  2001 I App: info
06-01 10:00:00.003  1001  3001 I App: other
06-01 10:00:00.004  1001  2001 W App: warn
''')
        _, rg_total, _ = _rg_search(indexes, tid=2001)
        _, py_total, _ = _search(indexes, tid=2001)
        assert_results_equal(self, rg_total, py_total, 'TID=2001')
        self.assertEqual(rg_total, 3)

    # ----------------------------------------------------------------
    # 9. Tag 过滤
    # ----------------------------------------------------------------
    def test_tag_filter(self):
        indexes = self._load('tag', '''\
06-01 10:00:00.001  100  200 I Com_App: msg
06-01 10:00:00.002  100  200 I Bt_Serv: pairing
06-01 10:00:00.003  100  200 E Bt_Serv: error
06-01 10:00:00.004  100  200 I Wifi_Mgr: connected
''')
        cases = [
            ('Bt_Serv', 2, 'tag exact'),
            ('Com', 1, 'tag partial'),
        ]
        for tag, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, tag_substr=tag)
            _, py_total, _ = _search(indexes, tag_substr=tag)
            assert_results_equal(self, rg_total, py_total, label)
            self.assertEqual(rg_total, expected, label)

    # ----------------------------------------------------------------
    # 10. 大小写一致性 (RG 用 (?i) 前缀)
    # ----------------------------------------------------------------
    def test_case_sensitivity(self):
        indexes = self._load('case', '''\
06-01 10:00:00.001  100  200 I TagA: Error handler
06-01 10:00:00.002  100  200 I TagA: error handler
06-01 10:00:00.003  100  200 I TagA: ERROR HANDLER
06-01 10:00:00.004  100  200 I TagA: CrashReport
06-01 10:00:00.005  100  200 I TagA: crashreport
06-01 10:00:00.006  100  200 I TagA: crash report
''')
        cases = [
            ('error', 3, 'keyword error'),
            ('ERROR', 3, 'keyword ERROR'),
            ('CrashReport', 2, 'rule CrashReport'),
            ('crash', 3, 'rule crash'),
        ]
        for kw, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, keyword=kw)
            _, py_total, _ = _search(indexes, keyword=kw)
            assert_results_equal(self, rg_total, py_total, label)
            self.assertEqual(rg_total, expected, label)

    # ----------------------------------------------------------------
    # 11. 复杂组合
    # ----------------------------------------------------------------
    def test_complex_combined(self):
        indexes = self._load('complex', '''\
06-01 10:00:00.001  1001  2001 D Com_App: login ok
06-01 10:00:00.002  1001  2001 I Com_App: login ok
06-01 10:00:00.003  2002  3002 W Bt_Serv: pairing timeout
06-01 10:00:00.004  2002  3002 E Bt_Serv: pairing timeout
06-01 10:00:00.005  1001  2001 D Com_App: sync done
06-01 10:00:00.006  1001  2001 I Com_App: sync done
06-01 10:00:00.007  3003  4003 W Wifi_Mgr: drop
06-01 10:00:00.008  3003  4003 E Wifi_Mgr: drop
06-01 10:00:00.009  4004  5004 I Test_Tag: heartbeat
06-01 10:00:00.010  4004  5004 D Test_Tag: heartbeat
''')
        cases = [
            ({'levels': ['W','E'], 'keyword': 'pairing'}, 2, 'lev+keyword'),
            ({'levels': ['I'], 'pid': 1001, 'keyword': 'login'}, 1, 'lev+pid+kw'),
            ({'tag_substr': 'Bt_Serv', 'levels': ['W']}, 1, 'tag+lev'),
            ({'keyword': 'heartbeat'}, 2, 'keyword'),
            ({'pid': 4004, 'levels': ['D','I']}, 2, 'pid+lev'),
        ]
        for kwargs, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, **kwargs)
            _, py_total, _ = _search(indexes, **kwargs)
            assert_results_equal(self, rg_total, py_total, label)
            self.assertEqual(rg_total, expected, label)

    # ----------------------------------------------------------------
    # 12. 多文件一致性
    # ----------------------------------------------------------------
    def test_multi_file(self):
        idx1 = self._load('mf1', '''\
06-01 10:00:00.001  100  200 I File1: alpha
06-01 10:00:00.002  100  200 E File1: error1
06-01 10:00:00.003  100  200 I File1: beta
''')
        idx2 = self._load('mf2', '''\
06-01 10:00:00.001  100  200 I File2: gamma
06-01 10:00:00.002  100  200 W File2: warning
06-01 10:00:00.003  100  200 I File2: delta
''')
        indexes = idx1 + idx2
        cases = [
            ({'levels': ['D','I','W','E']}, 6, 'all'),
            ({'levels': ['E']}, 1, 'only E'),
            ({'keyword': 'error'}, 1, 'keyword'),
            ({'levels': ['E','W'], 'keyword': 'error|warning'}, 2, 'lev+kw'),
        ]
        for kwargs, expected, label in cases:
            _, rg_total, _ = _rg_search(indexes, **kwargs)
            _, py_total, _ = _search(indexes, **kwargs)
            assert_results_equal(self, rg_total, py_total, f'multi {label}')
            self.assertEqual(rg_total, expected, f'multi {label}')


if __name__ == '__main__':
    unittest.main(verbosity=2)