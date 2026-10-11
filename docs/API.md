# 飞行遥测 API

当前 Go API 为 TwinSpace 的飞行轨迹工作区提供任务与实时遥测。数字孪生工作区的园区资产和指标目前由前端示例数据驱动，不属于本文接口契约。

## 通用约定

- 默认地址：`http://127.0.0.1:8080`
- JSON 响应：`Content-Type: application/json`
- 时间戳：Unix 秒
- 位置：WGS84 风格的十进制度数；默认地图提供商可能使用不同坐标体系
- 距离与速度：米、米/秒
- 姿态角：度

当前协议未显式版本化。外部集成应只依赖本文记录的字段，并在升级前运行契约测试。

## 健康检查

`GET /healthz`

```json
{"status":"ok"}
```

该端点只表示 HTTP 进程可响应，不检查外部地图服务或浏览器渲染。

## 任务配置

`GET /api/config`

```json
{
  "name": "深圳无人机巡航演示",
  "launchPoint": {"lng": 113.9325, "lat": 22.5317, "alt": 50},
  "drones": [
    {
      "id": "uav-001",
      "name": "核心航线",
      "color": "#00ffff",
      "speed": 15,
      "route": [
        {"lng": 113.9301, "lat": 22.5334, "alt": 150},
        {"lng": 113.9425, "lat": 22.5155, "alt": 160}
      ]
    }
  ]
}
```

## 当前状态

`PUT /api/drones/{id}/route` 更新指定无人机的监控航线。请求体为 `{"route":[{"lng":113.93,"lat":22.53,"alt":100},{"lng":113.94,"lat":22.52,"alt":100}]}`。航线至少需要两个航点、坐标须在有效范围内，并且至少包含一段不同的水平位置。无效请求返回 `400`，未知无人机返回 `404`。飞行中的无人机在到达下一个航点后采用新航线；尚未起飞的无人机下次派遣时采用新航线。

`GET /api/state`

返回版本化遥测包。服务刚启动、第一次 tick 尚未发生时，姿态和时间戳可能保持初始零值。

```json
{
  "v": 1,
  "drones": [
    {
      "droneId": "uav-001",
      "lng": 113.9301,
      "lat": 22.5334,
      "alt": 150,
      "heading": 145.2,
      "pitch": 0.31,
      "roll": -1.42,
      "speed": 7.65,
      "battery": 100,
      "timestamp": 1786593600,
      "status": "flying",
      "waypointIndex": 0,
      "avoidanceActive": false
    }
  ],
  "alerts": [
    {
      "id": "uav-001~uav-002",
      "droneA": "uav-001",
      "droneB": "uav-002",
      "distanceM": 80.5,
      "severity": "warning",
      "predictedMinM": 40.2,
      "evading": false,
      "timestamp": 1786593600
    }
  ]
}
```

告警为仿真可视化演示（预警 100 米、临界 50 米），不可用于真实飞行安全决策。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `droneId` | string | 任务内唯一 ID |
| `lng`, `lat` | number | 当前经纬度 |
| `alt` | number | 当前高度，米（含仿真避障偏移） |
| `heading` | number | 真北方向航向角，范围 `[0, 360)` |
| `pitch`, `roll` | number | 俯仰角和横滚角 |
| `speed` | number | 当前模拟速度，米/秒 |
| `battery` | number | 模拟电量百分比 |
| `timestamp` | integer | 状态生成时间，Unix 秒 |
| `status` | string | `staged`、`launching`、`flying`、`manual`、`returning` 或 `returning-to-base` |
| `waypointIndex` | integer | 当前航段起点索引 |
| `avoidanceActive` | boolean | 仿真避障偏移是否生效 |

## 告警快照

`GET /api/alerts`

返回与 `/api/state` 中 `alerts` 相同的仿真接近告警数组，空数组表示当前无 100 米内接近或预测冲突。

## WebSocket 遥测

`GET /ws`

握手成功后，服务按 `TICK_INTERVAL` 持续发送文本帧。每一帧都是与 `/api/state` 相同结构的完整 JSON 数组。客户端可发送 `{"type":"launch","droneId":"uav-001"}` 单独放飞无人机，或发送 `{"type":"launch-all"}` 放飞所有待命无人机。放飞后无人机先飞往自己的航线首点，再沿既有航线巡航。发送 `{"type":"return-to-base","droneId":"uav-001"}` 可单独召回无人机；`{"type":"return-all-to-base"}` 会召回全队。召回会取消对应无人机当前航线和手动控制，直接返回共用基地；到达后停留在基地待命。

浏览器示例：

```javascript
const socket = new WebSocket('ws://127.0.0.1:8080/ws')

socket.addEventListener('message', (event) => {
  const fleet = JSON.parse(event.data)
  console.log(fleet)
})
```

浏览器握手的 `Origin` 必须通过 `ALLOWED_ORIGINS` 校验。外部域名执行协议、主机和端口的精确匹配；当白名单包含本机回环地址时，相同协议下的 `localhost`、`127.0.0.1` 和 `::1` 可以使用其他回环端口，以兼容 Vite 自动选择空闲端口。非浏览器客户端未发送 Origin 时允许连接。

## 错误行为

- 未注册路径返回 `404 Not Found`。
- 已注册路径使用错误方法返回 `405 Method Not Allowed`。
- WebSocket Origin 不允许时握手返回 `403 Forbidden`。
- 无效任务配置会阻止 API 启动，不会通过 HTTP 返回部分任务。
