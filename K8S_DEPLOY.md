# Оркестрация Kubernetes для PlagiarismGuard

В проект добавлен Kubernetes-модуль в папке `k8s/`.

## Как здесь работает оркестрация

- Kubernetes запускает приложение в виде Pod-ов, которыми управляют Deployment-ы.
- `plagiarismguard-app` - контейнер с Next.js приложением.
- `plagiarismguard-nginx` - слой reverse-proxy перед pod-ами приложения.
- Service предоставляет стабильные внутренние DNS-имена между pod-ами.
- Ingress публикует приложение наружу по домену (`guard-main.by`).
- PVC хранит постоянные данные из `/app/data`.

Текущий поток трафика:

`Internet -> Ingress -> nginx service -> nginx pods -> app service -> app pod`

## Реализованные "3-4 потока/модуля"

Оркестрация разбита на модули:

1. модуль `app` (Deployment + Service)
2. модуль `nginx` (Deployment + Service)
3. модуль `config` (ConfigMap + Secret)
4. модуль `routing/storage` (Ingress + PVC)

## Шаги деплоя

1) Соберите образ приложения:

```bash
docker build -t plagiarismguard-app:latest .
```

2) Если используете `kind`, загрузите образ в кластер:

```bash
kind load docker-image plagiarismguard-app:latest
```

3) Создайте реальный secret из локального env-файла (рекомендуется):

```bash
kubectl create namespace plagiarismguard --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic plagiarismguard-app-secret \
  --namespace plagiarismguard \
  --from-env-file=.env.local \
  --dry-run=client -o yaml | kubectl apply -f -
```

Убедитесь, что в `.env.local` есть:

- `DATABASE_URL=postgresql://...`
- `ANALYSIS_SERVICE_URL=http://...:8765`

4) Примените манифесты:

```bash
kubectl apply -k k8s
```

5) Инициализируйте схему БД (однократно на новую среду, или при изменении схемы):

```bash
kubectl exec -n plagiarismguard deploy/plagiarismguard-app -- npx prisma db push
```

6) Проверьте статус:

```bash
kubectl get pods,svc,ingress -n plagiarismguard
kubectl describe pod -n plagiarismguard
```

## Примечания

- В `k8s/kustomization.yaml` есть `secret-app.example.yaml`. Для production лучше создавать secret через `kubectl create secret ... --from-env-file` и не хранить реальные креды в git.
- Для `app` сейчас указано `replicas: 1`, потому что приложение пишет локальные файлы в `/app/data`. Для горизонтального масштабирования сначала перенесите файлы в общее объектное хранилище (MinIO/S3/NFS), затем увеличивайте число реплик.
