import os


class Settings:
    # 实测实例（LAN 部署默认值）；检索客户端与 /proxy/weknora 反向代理共用此地址
    weknora_base_url: str = os.environ.get("WEKNORA_BASE_URL", "http://10.137.200.58:8091")
    weknora_api_key: str = os.environ.get("WEKNORA_API_KEY", "")
    gateway_token: str = os.environ.get("GATEWAY_TOKEN", "")


settings = Settings()
